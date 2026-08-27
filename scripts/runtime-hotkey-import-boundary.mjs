import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API } from 'typescript/unstable/sync'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import {
  SyntaxKind,
  NodeFlags,
  isAsExpression,
  isBinaryExpression,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isSatisfiesExpression,
  isStringLiteral,
  isTemplateExpression,
  isTypeAssertion,
  isVariableStatement,
} from 'typescript/unstable/ast'

const REACT_HOTKEYS_HOOK_MODULE = 'react-hotkeys-hook'
export const RUNTIME_HOTKEY_ADAPTER_PATH = 'src/hooks/use-hotkey-registration.ts'

const CONSTANT_STRING_WRAPPER_CHECKS = [
  isParenthesizedExpression,
  isAsExpression,
  isSatisfiesExpression,
  isTypeAssertion,
]

function evaluateTemplateString(expression, constantBindings, resolving) {
  let value = expression.head.text
  for (const span of expression.templateSpans) {
    const interpolation = evaluateConstantString(span.expression, constantBindings, resolving)
    if (interpolation === undefined) return undefined
    value += interpolation + span.literal.text
  }
  return value
}

function evaluateConcatenatedString(expression, constantBindings, resolving) {
  if (expression.operatorToken.kind !== SyntaxKind.PlusToken) return undefined
  const left = evaluateConstantString(expression.left, constantBindings, resolving)
  const right = evaluateConstantString(expression.right, constantBindings, resolving)
  return left === undefined || right === undefined ? undefined : left + right
}

function evaluateConstantBinding(expression, constantBindings, resolving) {
  if (!constantBindings.has(expression.text) || resolving.has(expression.text)) return undefined
  const nextResolving = new Set(resolving).add(expression.text)
  return evaluateConstantString(
    constantBindings.get(expression.text),
    constantBindings,
    nextResolving,
  )
}

function evaluateConstantString(expression, constantBindings, resolving = new Set()) {
  if (!expression) return undefined
  if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }
  if (CONSTANT_STRING_WRAPPER_CHECKS.some((check) => check(expression))) {
    return evaluateConstantString(expression.expression, constantBindings, resolving)
  }
  if (isTemplateExpression(expression)) {
    return evaluateTemplateString(expression, constantBindings, resolving)
  }
  if (isBinaryExpression(expression)) {
    return evaluateConcatenatedString(expression, constantBindings, resolving)
  }
  if (isIdentifier(expression)) {
    return evaluateConstantBinding(expression, constantBindings, resolving)
  }
  return undefined
}

function isReactHotkeysSource(source, constantBindings) {
  return evaluateConstantString(source, constantBindings) === REACT_HOTKEYS_HOOK_MODULE
}

function isStaticReactHotkeysImport(node, constantBindings) {
  return (
    (isImportDeclaration(node) || isExportDeclaration(node)) &&
    isReactHotkeysSource(node.moduleSpecifier, constantBindings)
  )
}

function isTypeScriptReactHotkeysImport(node, constantBindings) {
  if (!isImportEqualsDeclaration(node)) return false
  const reference = node.moduleReference
  return (
    isExternalModuleReference(reference) &&
    isReactHotkeysSource(reference.expression, constantBindings)
  )
}

function isReactHotkeysCallImport(node, constantBindings) {
  if (!isCallExpression(node)) return false
  const { expression, arguments: args } = node
  const isRequire = isIdentifier(expression) && expression.text === 'require'
  const isDynamicImport = expression.kind === SyntaxKind.ImportKeyword
  return (
    (isRequire || isDynamicImport) &&
    args.length === 1 &&
    isReactHotkeysSource(args[0], constantBindings)
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

function topLevelConstantBindings(sourceFile) {
  const bindings = new Map()
  for (const statement of sourceFile.statements) {
    if (!isVariableStatement(statement)) continue
    const declarationList = statement.declarationList
    if (!(declarationList.flags & NodeFlags.Const)) continue
    for (const declaration of declarationList.declarations) {
      if (isIdentifier(declaration.name) && declaration.initializer) {
        bindings.set(declaration.name.text, declaration.initializer)
      }
    }
  }
  return bindings
}

export function findReactHotkeysHookImportViolations(
  sources,
  allowedPath = RUNTIME_HOTKEY_ADAPTER_PATH,
) {
  const violations = []
  if (sources.length === 0) return violations

  const virtualRoot = '/runtime-hotkey-import-boundary'
  const virtualSources = new Map()
  const virtualFiles = Object.fromEntries(
    sources.map((candidate, index) => {
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
      const constantBindings = topLevelConstantBindings(sourceFile)

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
        if (IMPORT_NODE_CHECKS.some((check) => check(node, constantBindings))) record(node)
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

function productionSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return []
    return [path]
  })
}

function runCli() {
  const root = process.cwd()
  const files = productionSourceFiles(join(root, 'src'))
  const sources = files.map((path) => ({
    path: relative(root, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }))
  const violations = findReactHotkeysHookImportViolations(sources)

  if (violations.length > 0) {
    console.error(violations.map(({ message }) => message).join('\n'))
    process.exitCode = 1
    return
  }

  console.log(
    `Runtime hotkey import boundary passed (${files.length} source files; allowed adapter: ${RUNTIME_HOTKEY_ADAPTER_PATH})`,
  )
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) runCli()
