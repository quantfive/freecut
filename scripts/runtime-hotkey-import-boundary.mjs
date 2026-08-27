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
} from 'typescript/unstable/ast'

const REACT_HOTKEYS_HOOK_MODULE = 'react-hotkeys-hook'
export const RUNTIME_HOTKEY_ADAPTER_PATH = 'src/hooks/use-hotkey-registration.ts'

const CONSTANT_STRING_WRAPPER_CHECKS = [
  isParenthesizedExpression,
  isAsExpression,
  isSatisfiesExpression,
  isTypeAssertion,
]

const FUNCTION_SCOPE_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])

const NAMED_FUNCTION_SCOPE_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
])

const CLASS_SCOPE_KINDS = new Set([SyntaxKind.ClassDeclaration, SyntaxKind.ClassExpression])

const LOOP_SCOPE_KINDS = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
])

const BLOCK_SCOPE_KINDS = new Set([
  SyntaxKind.Block,
  SyntaxKind.ClassStaticBlockDeclaration,
  SyntaxKind.ModuleBlock,
])

const BLOCK_VAR_SCOPE_KINDS = new Set([
  SyntaxKind.ClassStaticBlockDeclaration,
  SyntaxKind.ModuleBlock,
])

const BARRIER_DECLARATION_KINDS = new Set([
  SyntaxKind.EnumDeclaration,
  SyntaxKind.ModuleDeclaration,
])

function createScope(parent, kind, isVarScope = false, isConstantBoundary = false) {
  return { parent, kind, isVarScope, isConstantBoundary, bindings: new Map() }
}

function declareBinding(scope, name, binding) {
  if (scope.bindings.has(name)) {
    scope.bindings.set(name, { kind: 'barrier' })
    return
  }
  scope.bindings.set(name, binding)
}

function bindingNames(name) {
  if (isIdentifier(name)) return [name.text]
  if (name.kind !== SyntaxKind.ObjectBindingPattern && name.kind !== SyntaxKind.ArrayBindingPattern) {
    return []
  }
  return name.elements.flatMap((element) => (element.name ? bindingNames(element.name) : []))
}

function declareBarrier(scope, name) {
  for (const identifier of bindingNames(name)) {
    declareBinding(scope, identifier, { kind: 'barrier' })
  }
}

function nearestVarScope(scope) {
  let current = scope
  while (current.parent && !current.isVarScope) current = current.parent
  return current
}

function declareVariableList(declarationList, scope) {
  const isConst = Boolean(declarationList.flags & NodeFlags.Const)
  const isBlockScoped = Boolean(declarationList.flags & NodeFlags.BlockScoped)
  const declarationScope = isBlockScoped ? scope : nearestVarScope(scope)
  // Rolldown keeps loop-header identifier imports dynamic even when the
  // header declares a const literal, so those bindings remain barriers.
  const isResolvableConst = isConst && declarationScope.kind !== 'loop'

  for (const declaration of declarationList.declarations) {
    if (isResolvableConst && isIdentifier(declaration.name) && declaration.initializer) {
      declareBinding(declarationScope, declaration.name.text, {
        kind: 'constant',
        initializer: declaration.initializer,
        scope: declarationScope,
        availableAfter: declaration.end,
      })
      continue
    }
    declareBarrier(declarationScope, declaration.name)
  }
}

function declareImportBindings(node, scope) {
  if (isImportEqualsDeclaration(node)) {
    declareBarrier(scope, node.name)
    return
  }
  if (!isImportDeclaration(node) || !node.importClause) return

  const { name, namedBindings } = node.importClause
  if (name) declareBarrier(scope, name)
  if (!namedBindings) return
  if (namedBindings.name) {
    declareBarrier(scope, namedBindings.name)
    return
  }
  for (const element of namedBindings.elements) declareBarrier(scope, element.name)
}

function createFunctionLexicalScope(node, currentScope) {
  if (node.kind === SyntaxKind.FunctionDeclaration && node.name) {
    declareBarrier(currentScope, node.name)
  }

  const functionScope = createScope(currentScope, 'function', true, true)
  if (NAMED_FUNCTION_SCOPE_KINDS.has(node.kind) && node.name) {
    declareBarrier(functionScope, node.name)
  }
  for (const parameter of node.parameters ?? []) declareBarrier(functionScope, parameter.name)
  return functionScope
}

function createClassLexicalScope(node, currentScope) {
  if (node.kind === SyntaxKind.ClassDeclaration && node.name) {
    declareBarrier(currentScope, node.name)
  }

  const classScope = createScope(currentScope, 'class', false, true)
  if (node.name) declareBarrier(classScope, node.name)
  return classScope
}

function createChildLexicalScope(node, currentScope) {
  if (FUNCTION_SCOPE_KINDS.has(node.kind)) {
    return createFunctionLexicalScope(node, currentScope)
  }
  if (CLASS_SCOPE_KINDS.has(node.kind)) {
    return createClassLexicalScope(node, currentScope)
  }
  if (node.kind === SyntaxKind.CatchClause) {
    const catchScope = createScope(currentScope, 'catch', false, true)
    if (node.variableDeclaration) declareBarrier(catchScope, node.variableDeclaration.name)
    return catchScope
  }
  if (node.kind === SyntaxKind.SwitchStatement) return createScope(currentScope, 'block')
  if (!BLOCK_SCOPE_KINDS.has(node.kind)) return undefined

  return createScope(
    currentScope,
    'block',
    BLOCK_VAR_SCOPE_KINDS.has(node.kind),
    node.kind === SyntaxKind.ModuleBlock,
  )
}

function predeclareNodeBindings(node, currentScope) {
  if (node.kind === SyntaxKind.VariableDeclarationList) {
    declareVariableList(node, currentScope)
    return
  }
  if (isImportDeclaration(node) || isImportEqualsDeclaration(node)) {
    declareImportBindings(node, currentScope)
    return
  }
  if (BARRIER_DECLARATION_KINDS.has(node.kind) && node.name) {
    declareBarrier(currentScope, node.name)
  }
}

function buildLexicalScopes(sourceFile) {
  const sourceScope = createScope(undefined, 'source', true, true)
  const nodeScopes = new WeakMap()

  function visitLoopHeader(node, currentScope) {
    if (!node) return
    nodeScopes.set(node, currentScope)
    node.forEachChild((child) => visit(child, currentScope))
  }

  function visitLoop(node, currentScope) {
    const loopScope = createScope(currentScope, 'loop', false, true)

    if (node.kind === SyntaxKind.ForStatement) {
      // Rolldown folds outer constants in a classic-for initializer, then
      // stops carrying them through the condition, update, and body.
      if (node.initializer?.kind === SyntaxKind.VariableDeclarationList) {
        declareVariableList(node.initializer, loopScope)
        visitLoopHeader(node.initializer, currentScope)
      } else {
        visit(node.initializer, currentScope)
      }
      visit(node.condition, loopScope)
      visit(node.incrementor, loopScope)
      visit(node.statement, loopScope)
      return
    }

    if (node.kind === SyntaxKind.ForInStatement || node.kind === SyntaxKind.ForOfStatement) {
      if (node.initializer.kind === SyntaxKind.VariableDeclarationList) {
        declareVariableList(node.initializer, loopScope)
        visitLoopHeader(node.initializer, currentScope)
      } else {
        visit(node.initializer, currentScope)
      }
      // The collection expression behaves like an initializer; the repeated
      // body is the constant-resolution boundary.
      visit(node.expression, currentScope)
      visit(node.statement, loopScope)
      return
    }

    visit(node.expression, loopScope)
    visit(node.statement, loopScope)
  }

  function visit(node, currentScope) {
    if (!node) return
    nodeScopes.set(node, currentScope)
    if (LOOP_SCOPE_KINDS.has(node.kind)) {
      visitLoop(node, currentScope)
      return
    }
    const childScope = createChildLexicalScope(node, currentScope)
    if (!childScope) predeclareNodeBindings(node, currentScope)
    node.forEachChild((child) => visit(child, childScope ?? currentScope))
  }

  visit(sourceFile, sourceScope)
  return { nodeScopes, sourceScope }
}

function findBinding(scope, name) {
  let current = scope
  while (current) {
    const binding = current.bindings.get(name)
    if (binding) return binding
    // Rolldown folds through ordinary lexical blocks, but not through
    // captured, catch, repeated-loop, or namespace environments.
    if (current.isConstantBoundary) return undefined
    current = current.parent
  }
  return undefined
}

function isBindingAvailable(binding, referencePosition) {
  return binding.availableAfter === undefined || referencePosition >= binding.availableAfter
}

function evaluateTemplateString(expression, scope, resolving) {
  let value = expression.head.text
  const dependencies = []
  for (const span of expression.templateSpans) {
    const interpolation = evaluateConstantString(span.expression, scope, resolving)
    if (!interpolation) return undefined
    value += interpolation.value + span.literal.text
    dependencies.push(...interpolation.dependencies)
  }
  return { value, dependencies }
}

function evaluateConcatenatedString(expression, scope, resolving) {
  if (expression.operatorToken.kind !== SyntaxKind.PlusToken) return undefined
  const left = evaluateConstantString(expression.left, scope, resolving)
  const right = evaluateConstantString(expression.right, scope, resolving)
  if (!left || !right) return undefined
  return {
    value: left.value + right.value,
    dependencies: [...left.dependencies, ...right.dependencies],
  }
}

function evaluateConstantBindingValue(binding, resolving) {
  // Bindings are stable identities, so aliases keep the declaration-time
  // environment even when the same name is shadowed at a later use site.
  if (binding.cachedValue !== undefined) return binding.cachedValue
  if (resolving.has(binding)) return undefined

  const nextResolving = new Set(resolving).add(binding)
  const result = evaluateConstantString(binding.initializer, binding.scope, nextResolving)
  binding.cachedValue = result ?? null
  return result
}

function dependencyMatchesUseSite(dependency, referenceScope, referencePosition, resolving) {
  const visibleBinding = findBinding(referenceScope, dependency.name)
  if (
    !visibleBinding ||
    visibleBinding === dependency.binding ||
    !isBindingAvailable(visibleBinding, referencePosition)
  ) {
    return true
  }
  if (visibleBinding.kind !== 'constant') return false

  // A same-value shadow is eliminated by Rolldown and does not prevent the
  // captured alias from becoming a literal import. An unknown shadow does.
  const visibleValue = evaluateConstantBindingValue(visibleBinding, resolving)
  return visibleValue?.value === dependency.value
}

function evaluateConstantBinding(expression, scope, resolving, referenceScope, referencePosition) {
  const binding = findBinding(scope, expression.text)
  if (
    !binding ||
    binding.kind !== 'constant' ||
    resolving.has(binding) ||
    !isBindingAvailable(binding, expression.getStart())
  ) {
    return undefined
  }

  const value = evaluateConstantBindingValue(binding, resolving)
  if (!value) return undefined
  const dependencies = [
    { name: expression.text, binding, value: value.value },
    ...value.dependencies,
  ]
  if (
    !dependencies.every((dependency) =>
      dependencyMatchesUseSite(dependency, referenceScope, referencePosition, resolving),
    )
  ) {
    return undefined
  }
  return { value: value.value, dependencies }
}

function evaluateConstantString(
  expression,
  scope,
  resolving = new Set(),
  referenceScope = scope,
  referencePosition = expression?.getStart() ?? 0,
) {
  if (!expression) return undefined
  if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
    return { value: expression.text, dependencies: [] }
  }
  if (CONSTANT_STRING_WRAPPER_CHECKS.some((check) => check(expression))) {
    return evaluateConstantString(
      expression.expression,
      scope,
      resolving,
      referenceScope,
      referencePosition,
    )
  }
  if (isTemplateExpression(expression)) {
    return evaluateTemplateString(expression, scope, resolving)
  }
  if (isBinaryExpression(expression)) {
    return evaluateConcatenatedString(expression, scope, resolving)
  }
  if (isIdentifier(expression)) {
    return evaluateConstantBinding(
      expression,
      scope,
      resolving,
      referenceScope,
      referencePosition,
    )
  }
  return undefined
}

function isReactHotkeysSource(source, scope) {
  return evaluateConstantString(source, scope)?.value === REACT_HOTKEYS_HOOK_MODULE
}

function isStaticReactHotkeysImport(node, scope) {
  return (
    (isImportDeclaration(node) || isExportDeclaration(node)) &&
    isReactHotkeysSource(node.moduleSpecifier, scope)
  )
}

function isTypeScriptReactHotkeysImport(node, scope) {
  if (!isImportEqualsDeclaration(node)) return false
  const reference = node.moduleReference
  return isExternalModuleReference(reference) && isReactHotkeysSource(reference.expression, scope)
}

function isReactHotkeysCallImport(node, scope) {
  if (!isCallExpression(node)) return false
  const { expression, arguments: args } = node
  const isRequire = isIdentifier(expression) && expression.text === 'require'
  const isDynamicImport = expression.kind === SyntaxKind.ImportKeyword
  return (
    (isRequire || isDynamicImport) &&
    args.length === 1 &&
    isReactHotkeysSource(args[0], scope)
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
      const { nodeScopes, sourceScope } = buildLexicalScopes(sourceFile)

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
        const scope = nodeScopes.get(node) ?? sourceScope
        if (IMPORT_NODE_CHECKS.some((check) => check(node, scope))) record(node)
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
