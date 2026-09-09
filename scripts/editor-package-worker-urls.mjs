import { parseSync, Visitor } from 'vite-plus'

function isImportMetaUrl(node) {
  return node?.type === 'MemberExpression' && !node.computed &&
    node.object.type === 'MetaProperty' && node.object.meta.name === 'import' &&
    node.object.property.name === 'meta' && node.property.type === 'Identifier' &&
    node.property.name === 'url'
}

function isGeneratedWorkerBase(node) {
  return isImportMetaUrl(node) || (node?.type === 'BinaryExpression' && node.operator === '+' &&
    node.left.type === 'Literal' && node.left.value === '' && isImportMetaUrl(node.right))
}

function isNamedConstructor(node, name) {
  return node?.type === 'NewExpression' && node.callee.type === 'Identifier' &&
    node.callee.name === name
}

function publicWorkerUrl(url) {
  if (!isNamedConstructor(url, 'URL') || url.arguments.length !== 2) return null
  const [asset, base] = url.arguments
  if (asset.type !== 'Literal' || typeof asset.value !== 'string' ||
    !/^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(asset.value) || !isGeneratedWorkerBase(base)) return null
  return { start: url.start, end: url.end, text: JSON.stringify(asset.value) }
}

/** Embedded hosts stage workers at their public root; keep them runtime URLs for Turbopack. */
export function normalizeEditorWorkerUrls(code, filename = 'editor-chunk.js') {
  if (!code.includes('/assets/')) return code
  const parsed = parseSync(filename, code)
  if (parsed.errors.length) throw new Error(`Cannot inspect editor worker URLs in ${filename}`)
  const replacements = []
  new Visitor({
    NewExpression(node) {
      if (node.callee.type !== 'Identifier' || !['Worker', 'SharedWorker'].includes(node.callee.name)) return
      const replacement = publicWorkerUrl(node.arguments[0])
      if (replacement) replacements.push(replacement)
    },
  }).visit(parsed.program)
  return replacements.sort((left, right) => right.start - left.start).reduce(
    (result, replacement) => result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end),
    code,
  )
}
