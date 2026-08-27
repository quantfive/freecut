import { parse } from '@babel/parser'

const REACT_HOTKEYS_HOOK_MODULE = 'react-hotkeys-hook'
export const RUNTIME_HOTKEY_ADAPTER_PATH = 'src/hooks/use-hotkey-registration.ts'

function isReactHotkeysSource(source) {
  return source?.type === 'StringLiteral' && source.value === REACT_HOTKEYS_HOOK_MODULE
}

function isStaticReactHotkeysImport(node) {
  const hasStaticSource =
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportAllDeclaration'
  return hasStaticSource && isReactHotkeysSource(node.source)
}

function isTypeScriptReactHotkeysImport(node) {
  if (node.type !== 'TSImportEqualsDeclaration') return false
  const reference = node.moduleReference
  return (
    reference.type === 'TSExternalModuleReference' && isReactHotkeysSource(reference.expression)
  )
}

function isReactHotkeysCallImport(node) {
  if (node.type !== 'CallExpression') return false
  const { callee, arguments: args } = node
  const isRequire = callee.type === 'Identifier' && callee.name === 'require'
  return (
    (isRequire || callee.type === 'Import') && args.length === 1 && isReactHotkeysSource(args[0])
  )
}

function isReactHotkeysImportExpression(node) {
  return node.type === 'ImportExpression' && isReactHotkeysSource(node.source)
}

const IMPORT_NODE_CHECKS = [
  isStaticReactHotkeysImport,
  isTypeScriptReactHotkeysImport,
  isReactHotkeysCallImport,
  isReactHotkeysImportExpression,
]
const AST_METADATA_KEYS = new Set(['loc', 'start', 'end'])

function walkAst(root, onNode) {
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      pending.push(...node)
      continue
    }

    onNode(node)
    for (const [key, child] of Object.entries(node)) {
      if (!AST_METADATA_KEYS.has(key)) pending.push(child)
    }
  }
}

export function findReactHotkeysHookImportViolations(
  sources,
  allowedPath = RUNTIME_HOTKEY_ADAPTER_PATH,
) {
  const violations = []

  for (const { path, source } of sources) {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'dynamicImport'],
    })

    function record(node) {
      if (path !== allowedPath) {
        violations.push({
          path,
          line: node.loc?.start.line ?? 1,
          column: (node.loc?.start.column ?? 0) + 1,
        })
      }
    }

    walkAst(ast, (node) => {
      if (IMPORT_NODE_CHECKS.some((check) => check(node))) record(node)
    })
  }

  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  )
}
