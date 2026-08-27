import { API } from 'typescript/unstable/sync'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import {
  SyntaxKind,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isStringLiteral,
} from 'typescript/unstable/ast'

const REACT_HOTKEYS_HOOK_MODULE = 'react-hotkeys-hook'
export const RUNTIME_HOTKEY_ADAPTER_PATH = 'src/hooks/use-hotkey-registration.ts'

function isReactHotkeysSource(source) {
  return isStringLiteral(source) && source.text === REACT_HOTKEYS_HOOK_MODULE
}

function isStaticReactHotkeysImport(node) {
  return (
    (isImportDeclaration(node) || isExportDeclaration(node)) &&
    isReactHotkeysSource(node.moduleSpecifier)
  )
}

function isTypeScriptReactHotkeysImport(node) {
  if (!isImportEqualsDeclaration(node)) return false
  const reference = node.moduleReference
  return isExternalModuleReference(reference) && isReactHotkeysSource(reference.expression)
}

function isReactHotkeysCallImport(node) {
  if (!isCallExpression(node)) return false
  const { expression, arguments: args } = node
  const isRequire = isIdentifier(expression) && expression.text === 'require'
  const isDynamicImport = expression.kind === SyntaxKind.ImportKeyword
  return (
    (isRequire || isDynamicImport) && args.length === 1 && isReactHotkeysSource(args[0])
  )
}

const IMPORT_NODE_CHECKS = [
  isStaticReactHotkeysImport,
  isTypeScriptReactHotkeysImport,
  isReactHotkeysCallImport,
]

function walkAst(node, onNode) {
  onNode(node)
  node.forEachChild((child) => walkAst(child, onNode))
}

export function findReactHotkeysHookImportViolations(
  sources,
  allowedPath = RUNTIME_HOTKEY_ADAPTER_PATH,
) {
  const violations = []
  // Every import form we reject must contain the literal module specifier. This
  // prefilter keeps the compiler AST focused on the one or two relevant files.
  const candidates = sources.filter(({ source }) => source.includes(REACT_HOTKEYS_HOOK_MODULE))
  if (candidates.length === 0) return violations

  const virtualRoot = '/runtime-hotkey-import-boundary'
  const virtualSources = new Map()
  const virtualFiles = Object.fromEntries(
    candidates.map((candidate, index) => {
      const extension = candidate.path.endsWith('.tsx') ? 'tsx' : 'ts'
      const virtualPath = `${virtualRoot}/source-${index}.${extension}`
      virtualSources.set(virtualPath, candidate)
      return [virtualPath, candidate.source]
    }),
  )
  virtualFiles[`${virtualRoot}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { jsx: 'preserve', noLib: true },
    files: [...virtualSources.keys()],
  })

  const compiler = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(virtualFiles) })
  let snapshot

  try {
    snapshot = compiler.updateSnapshot({ openProjects: [`${virtualRoot}/tsconfig.json`] })
    const project = snapshot.getProjects()[0]

    for (const [virtualPath, { path }] of virtualSources) {
      const sourceFile = project?.program.getSourceFile(virtualPath)
      if (!sourceFile) throw new Error(`TypeScript could not parse in-memory source: ${path}`)

      function record(node) {
        if (path === allowedPath) return
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const line = location.line + 1
        const column = location.character + 1
        violations.push({
          path,
          line,
          column,
          allowedPath,
          message: `${path}:${line}:${column} imports ${REACT_HOTKEYS_HOOK_MODULE}; use ${allowedPath}`,
        })
      }

      walkAst(sourceFile, (node) => {
        if (IMPORT_NODE_CHECKS.some((check) => check(node))) record(node)
      })
    }
  } finally {
    snapshot?.dispose()
    compiler.close()
  }

  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  )
}
