import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API } from 'typescript/unstable/sync'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import {
  SyntaxKind,
  NodeFlags,
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isEnumDeclaration,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isToken,
  isTokenKind,
} from 'typescript/unstable/ast'

const REACT_HOTKEYS_HOOK_MODULE = 'react-hotkeys-hook'
export const RUNTIME_HOTKEY_ADAPTER_PATH = 'src/hooks/use-hotkey-registration.ts'

const MAX_CONSTANT_EVALUATION_DEPTH = 100

const BINARY_VALUE_RESOLVERS = new Map([
  [SyntaxKind.PlusToken, (left, right) => left + right],
  [SyntaxKind.AmpersandAmpersandToken, (left, right) => (left ? right : left)],
  [SyntaxKind.BarBarToken, (left, right) => (left ? left : right)],
  [SyntaxKind.QuestionQuestionToken, (left, right) => (left === null ? right : left)],
])

const UPDATE_OPERATORS = new Set([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken])

const SHORT_CIRCUIT_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
])

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

const LEXICAL_SCOPE_KINDS = new Set([
  ...FUNCTION_SCOPE_KINDS,
  ...CLASS_SCOPE_KINDS,
  SyntaxKind.CatchClause,
  SyntaxKind.SwitchStatement,
  ...BLOCK_SCOPE_KINDS,
])

const BINDING_DECLARATION_KINDS = new Set([
  SyntaxKind.VariableDeclarationList,
  SyntaxKind.ImportDeclaration,
  SyntaxKind.ImportEqualsDeclaration,
  ...BARRIER_DECLARATION_KINDS,
])

const UNCERTAIN_WRITE_ANCESTOR_KINDS = new Set([
  SyntaxKind.ConditionalExpression,
  SyntaxKind.DoStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.WithStatement,
])

function createScope(
  parent,
  kind,
  isVarScope = false,
  isConstantBoundary = false,
  owner,
) {
  const region = !parent || isConstantBoundary ? { bindings: new Map() } : parent.region
  return {
    parent,
    kind,
    isVarScope,
    isConstantBoundary,
    region,
    bindings: new Map(),
    owner: owner ?? parent?.owner,
  }
}

function declareBinding(scope, name, binding) {
  const regionBindings = scope.region.bindings.get(name) ?? []
  regionBindings.push(binding)
  scope.region.bindings.set(name, regionBindings)
  if (scope.bindings.has(name)) {
    const duplicate = { kind: 'barrier' }
    regionBindings.push(duplicate)
    scope.bindings.set(name, duplicate)
    return
  }
  scope.bindings.set(name, binding)
}

function hasModifier(node, kind) {
  return node?.modifiers?.some((modifier) => modifier.kind === kind) ?? false
}

function isAmbientDeclaration(node) {
  let current = node
  while (current) {
    if (hasModifier(current, SyntaxKind.DeclareKeyword)) return true
    current = current.parent
  }
  return false
}

function bindingNames(name) {
  if (isIdentifier(name)) return [name.text]
  if (name.kind !== SyntaxKind.ObjectBindingPattern && name.kind !== SyntaxKind.ArrayBindingPattern) {
    return []
  }
  return name.elements.flatMap((element) => (element.name ? bindingNames(element.name) : []))
}

function declareBarrier(scope, name, binding = { kind: 'barrier' }) {
  for (const identifier of bindingNames(name)) {
    declareBinding(scope, identifier, binding)
  }
}

function nearestVarScope(scope) {
  let current = scope
  while (current.parent && !current.isVarScope) current = current.parent
  return current
}

function variableBinding(declaration, declarationScope, isConst, isResolvableConst, isHoisted) {
  if (isResolvableConst && isIdentifier(declaration.name) && declaration.initializer) {
    return {
      kind: 'constant',
      initializer: declaration.initializer,
      scope: declarationScope,
      availableAfter: declaration.end,
    }
  }
  if (isIdentifier(declaration.name) && !isConst) {
    return {
      kind: 'mutable',
      initializer: declaration.initializer,
      scope: declarationScope,
      mutationPositions: [],
      writes: [],
      owner: declarationScope.owner,
      isHoisted,
      availableAfter: isHoisted ? 0 : declaration.end,
      assignmentAvailableAfter: declaration.end,
    }
  }
  return { kind: 'unknown-shadow', availableAfter: declaration.end }
}

function declareVariableList(declarationList, scope, { resolveLoopConstants = false } = {}) {
  const isConst = Boolean(declarationList.flags & NodeFlags.Const)
  const isBlockScoped = Boolean(declarationList.flags & NodeFlags.BlockScoped)
  const declarationScope = isBlockScoped ? scope : nearestVarScope(scope)
  const isResolvableConst =
    isConst && (declarationScope.kind !== 'loop' || resolveLoopConstants)
  const isAmbient = isAmbientDeclaration(declarationList)

  if (isAmbient) return

  for (const declaration of declarationList.declarations) {
    const binding = variableBinding(
      declaration,
      declarationScope,
      isConst,
      isResolvableConst,
      !isBlockScoped,
    )
    if (isIdentifier(declaration.name)) {
      declareBinding(declarationScope, declaration.name.text, binding)
    } else {
      declareBarrier(declarationScope, declaration.name, binding)
    }
  }
}

function declareImportBindings(node, scope) {
  if (isImportEqualsDeclaration(node)) return declareImportEqualsBinding(node, scope)
  if (!isImportDeclaration(node) || !node.importClause) return
  if (node.importClause.isTypeOnly) return

  const { name, namedBindings } = node.importClause
  if (name) declareBarrier(scope, name)
  declareNamedImportBindings(namedBindings, scope)
}

function declareImportEqualsBinding(node, scope) {
  if (!node.isTypeOnly) declareBarrier(scope, node.name)
}

function declareNamedImportBindings(namedBindings, scope) {
  if (!namedBindings) return
  if (namedBindings.name) {
    declareBarrier(scope, namedBindings.name)
    return
  }
  for (const element of namedBindings.elements) {
    if (!element.isTypeOnly) declareBarrier(scope, element.name)
  }
}

function createFunctionLexicalScope(node, currentScope) {
  if (
    node.kind === SyntaxKind.FunctionDeclaration &&
    node.name &&
    !isAmbientDeclaration(node)
  ) {
    declareBarrier(currentScope, node.name, { kind: 'static-shadow' })
  }

  const functionScope = createScope(currentScope, 'function', true, true, node)
  if (NAMED_FUNCTION_SCOPE_KINDS.has(node.kind) && node.name) {
    declareBarrier(functionScope, node.name)
  }
  for (const parameter of node.parameters ?? []) declareBarrier(functionScope, parameter.name)
  return functionScope
}

function createClassLexicalScope(node, currentScope) {
  if (node.kind === SyntaxKind.ClassDeclaration && node.name && !isAmbientDeclaration(node)) {
    declareBarrier(currentScope, node.name, { kind: 'static-shadow' })
  }

  const classScope = createScope(currentScope, 'class', false, true, node)
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
    node.kind === SyntaxKind.ModuleBlock ? node : undefined,
  )
}

function constEnumMemberDescriptor(member, index) {
  const supportedName =
    isIdentifier(member.name) || isStringLiteral(member.name) || isNumericLiteral(member.name)
  return supportedName ? { member, index, name: member.name.text } : undefined
}

function declareConstEnum(node, currentScope) {
  const memberList = node.members.map(constEnumMemberDescriptor)
  const members = new Map(
    memberList.filter(Boolean).map((descriptor) => [descriptor.name, descriptor]),
  )
  declareBinding(currentScope, node.name.text, {
    kind: 'const-enum',
    members,
    memberList,
    scope: currentScope,
    cachedValues: new Map(),
  })
}

function isConstEnumDeclaration(node) {
  return isEnumDeclaration(node) && hasModifier(node, SyntaxKind.ConstKeyword)
}

function predeclareNodeBindings(node, currentScope) {
  if (node.kind === SyntaxKind.VariableDeclarationList) return declareVariableList(node, currentScope)
  if (isImportDeclaration(node) || isImportEqualsDeclaration(node)) {
    return declareImportBindings(node, currentScope)
  }
  if (isConstEnumDeclaration(node) && !isAmbientDeclaration(node)) {
    return declareConstEnum(node, currentScope)
  }
  if (
    BARRIER_DECLARATION_KINDS.has(node.kind) &&
    node.name &&
    !isAmbientDeclaration(node)
  ) {
    declareBarrier(currentScope, node.name)
  }
}

function buildLexicalScopes(sourceFile) {
  const sourceScope = createScope(undefined, 'source', true, true, sourceFile)
  const nodeScopes = new WeakMap()
  const importNodes = []
  const writeDescriptors = []

  const view = sourceFile.view
  const offsetNodes = sourceFile._offsetNodes
  const nodeLength = sourceFile.constructor.NODE_LEN
  const nodeAt = (index, offset) => view.getUint32(offsetNodes + index * nodeLength + offset, true)
  const hasChild = (parentIndex, childIndex) =>
    childIndex < sourceFile.nodes.length &&
    nodeAt(childIndex, REMOTE_NODE_PARENT_OFFSET) === parentIndex

  function visitRawNode(index, currentScope) {
    const kind = nodeAt(index, REMOTE_NODE_KIND_OFFSET)
    if (kind === REMOTE_NODE_LIST_KIND || kind === SyntaxKind.JSDoc || isTokenKind(kind)) return
    if (!TRAVERSAL_NODE_KINDS.has(kind)) {
      visitRawChildren(index, currentScope)
      return
    }
    visit(sourceFile.getOrCreateNodeAtIndex(index), currentScope)
  }

  function visitRawChildren(parentIndex, currentScope) {
    const firstChildIndex = parentIndex + 1
    if (!hasChild(parentIndex, firstChildIndex)) return

    let childIndex = firstChildIndex
    do {
      const childKind = nodeAt(childIndex, REMOTE_NODE_KIND_OFFSET)
      if (childKind === REMOTE_NODE_LIST_KIND) {
        visitRawNodeList(childIndex, currentScope)
      } else visitRawNode(childIndex, currentScope)
      childIndex = nodeAt(childIndex, REMOTE_NODE_NEXT_OFFSET)
    } while (childIndex)
  }

  function visitRawNodeList(listIndex, currentScope) {
    const firstElementIndex = listIndex + 1
    if (!hasChild(listIndex, firstElementIndex)) return

    let elementIndex = firstElementIndex
    do {
      const elementKind = nodeAt(elementIndex, REMOTE_NODE_KIND_OFFSET)
      if (elementKind === REMOTE_NODE_LIST_KIND) {
        visitRawNodeList(elementIndex, currentScope)
      } else visitRawNode(elementIndex, currentScope)
      elementIndex = nodeAt(elementIndex, REMOTE_NODE_NEXT_OFFSET)
    } while (elementIndex)
  }

  function recordNode(node, currentScope) {
    if (IMPORT_NODE_KINDS.has(node.kind)) {
      nodeScopes.set(node, currentScope)
      importNodes.push(node)
    }
    if (node.kind === SyntaxKind.IfStatement || node.kind === SyntaxKind.ConditionalExpression) {
      nodeScopes.set(node.expression ?? node.condition, currentScope)
    } else if (
      isBinaryExpression(node) &&
      SHORT_CIRCUIT_OPERATORS.has(node.operatorToken.kind)
    ) {
      nodeScopes.set(node.left, currentScope)
    }
    if (WRITE_NODE_KINDS.has(node.kind)) {
      const descriptors = assignmentWriteDescriptors(node)
      if (descriptors.length > 0) writeDescriptors.push({ node, descriptors, scope: currentScope })
    }
  }

  function visitLoopHeader(node, currentScope) {
    if (!node || isToken(node)) return
    recordNode(node, currentScope)
    visitRawChildren(node.index, currentScope)
  }

  function visitLoop(node, currentScope) {
    const loopScope = createScope(currentScope, 'loop', false, true)

    if (node.kind === SyntaxKind.ForStatement) {
      // Rolldown folds outer constants in a classic-for initializer, then
      // stops carrying them through the condition, update, and body.
      if (node.initializer?.kind === SyntaxKind.VariableDeclarationList) {
        const initializerScope = createScope(currentScope, 'loop-initializer')
        declareVariableList(node.initializer, initializerScope, {
          resolveLoopConstants: true,
        })
        for (const declaration of node.initializer.declarations) {
          declareBarrier(loopScope, declaration.name)
        }
        visitLoopHeader(node.initializer, initializerScope)
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
        const initializerScope = createScope(currentScope, 'loop-initializer')
        declareVariableList(node.initializer, initializerScope, {
          resolveLoopConstants: true,
        })
        for (const declaration of node.initializer.declarations) {
          declareBarrier(loopScope, declaration.name)
        }
        visitLoopHeader(node.initializer, initializerScope)
        // A lexical for-in/of binding is in its temporal dead zone while the
        // collection expression is evaluated. Different names still see the
        // surrounding declaration environment.
        visit(node.expression, initializerScope)
      } else {
        visit(node.initializer, currentScope)
        visit(node.expression, currentScope)
      }
      visit(node.statement, loopScope)
      return
    }

    visit(node.expression, loopScope)
    visit(node.statement, loopScope)
  }

  function visit(node, currentScope) {
    if (!node || isToken(node)) return
    recordNode(node, currentScope)
    if (LOOP_SCOPE_KINDS.has(node.kind)) {
      visitLoop(node, currentScope)
      return
    }
    const childScope = LEXICAL_SCOPE_KINDS.has(node.kind)
      ? createChildLexicalScope(node, currentScope)
      : undefined
    if (!childScope && BINDING_DECLARATION_KINDS.has(node.kind)) {
      predeclareNodeBindings(node, currentScope)
    }
    visitRawChildren(node.index, childScope ?? currentScope)
  }

  visit(sourceFile, sourceScope)
  markMutableBindingWrites(writeDescriptors, nodeScopes, sourceScope)
  return { importNodes, nodeScopes, sourceScope }
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

function findLexicalBinding(scope, name) {
  let current = scope
  while (current) {
    const binding = current.bindings.get(name)
    if (binding) return binding
    current = current.parent
  }
  return undefined
}

function staticControlValue(expression, nodeScopes, sourceScope) {
  const scope = nodeScopes.get(expression) ?? sourceScope
  const result = evaluateConstantValue(
    expression,
    scope,
    new Set(),
    scope,
    expression.getStart(),
  )
  return result ? { known: true, value: result.value } : { known: false }
}

function conditionalBranchStatus(
  branch,
  condition,
  whenTrue,
  whenFalse,
  nodeScopes,
  sourceScope,
) {
  if (branch === condition) return 'reachable'
  const control = staticControlValue(condition, nodeScopes, sourceScope)
  if (!control.known) return 'uncertain'
  return branch === (control.value ? whenTrue : whenFalse) ? 'reachable' : 'unreachable'
}

function logicalRightStatus(node, expression, nodeScopes, sourceScope) {
  if (node !== expression.right) return 'reachable'
  const left = staticControlValue(expression.left, nodeScopes, sourceScope)
  if (!left.known) return 'uncertain'
  const executes =
    expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
      ? Boolean(left.value)
      : expression.operatorToken.kind === SyntaxKind.BarBarToken
        ? !left.value
        : left.value === null
  return executes ? 'reachable' : 'unreachable'
}

function controlFlowAncestorStatus(current, branch, nodeScopes, sourceScope) {
  if (current.kind === SyntaxKind.IfStatement) {
    return conditionalBranchStatus(
      branch,
      current.expression,
      current.thenStatement,
      current.elseStatement,
      nodeScopes,
      sourceScope,
    )
  }
  if (current.kind === SyntaxKind.ConditionalExpression) {
    return conditionalBranchStatus(
      branch,
      current.condition,
      current.whenTrue,
      current.whenFalse,
      nodeScopes,
      sourceScope,
    )
  }
  if (
    isBinaryExpression(current) &&
    SHORT_CIRCUIT_OPERATORS.has(current.operatorToken.kind)
  ) {
    return logicalRightStatus(branch, current, nodeScopes, sourceScope)
  }
  return UNCERTAIN_WRITE_ANCESTOR_KINDS.has(current.kind) ? 'uncertain' : 'reachable'
}

function controlFlowWriteStatus(node, owner, nodeScopes, sourceScope) {
  let branch = node
  let current = node.parent
  while (current && current !== owner) {
    const status = controlFlowAncestorStatus(current, branch, nodeScopes, sourceScope)
    if (status !== 'reachable') return status
    branch = current
    current = current.parent
  }
  return current === owner ? 'reachable' : 'uncertain'
}

function assignmentWriteDescriptors(node) {
  if (isBinaryExpression(node)) return binaryAssignmentWriteDescriptors(node)
  if (isPrefixUnaryExpression(node) || isPostfixUnaryExpression(node)) {
    return updateWriteDescriptors(node)
  }
  if (node.kind === SyntaxKind.ForInStatement || node.kind === SyntaxKind.ForOfStatement) {
    return loopWriteDescriptors(node)
  }
  return []
}

function binaryAssignmentWriteDescriptors(node) {
  if (
    node.operatorToken.kind < SyntaxKind.FirstAssignment ||
    node.operatorToken.kind > SyntaxKind.LastAssignment
  ) {
    return []
  }
  const names = bindingNames(node.left)
  if (names.length === 0) return []
  const isSimple = node.operatorToken.kind === SyntaxKind.EqualsToken
  return names.map((name) => ({
    name,
    expression: isSimple && isIdentifier(node.left) ? node.right : undefined,
    isSimple: isSimple && isIdentifier(node.left),
  }))
}

function updateWriteDescriptors(node) {
  if (!UPDATE_OPERATORS.has(node.operator) || !isIdentifier(node.operand)) return []
  return [{ name: node.operand.text, expression: undefined, isSimple: false }]
}

function loopWriteDescriptors(node) {
  return bindingNames(node.initializer).map((name) => ({
    name,
    expression: undefined,
    isSimple: false,
  }))
}

function markMutableBindingWrites(writeDescriptors, nodeScopes, sourceScope) {
  const writes = []
  for (const { node, descriptors, scope } of writeDescriptors) {
    for (const descriptor of descriptors) {
      const binding = findLexicalBinding(scope, descriptor.name)
      if (binding?.kind !== 'mutable') continue
      const write = {
        node,
        start: node.getStart(),
        position: node.end,
        expression: descriptor.expression,
        scope,
        isSimple: descriptor.isSimple,
        isReachable: true,
        isUncertain: true,
      }
      binding.writes.push(write)
      writes.push({ binding, write })
    }
  }

  for (const { binding, write } of writes) {
    const status =
      scopeOwner(write.scope) === binding.owner
        ? controlFlowWriteStatus(write.node, binding.owner, nodeScopes, sourceScope)
        : 'uncertain'
    write.isReachable = status !== 'unreachable'
    write.isUncertain = status !== 'reachable'
    if (write.isReachable) binding.mutationPositions.push(write.position)
  }
}

function scopeOwner(scope) {
  return scope?.owner
}

function isBindingAvailable(binding, referencePosition) {
  return binding.availableAfter === undefined || referencePosition >= binding.availableAfter
}

function evaluateTemplateValue(
  expression,
  scope,
  resolving,
  referenceScope,
  referencePosition,
  enumBinding,
  depth,
) {
  let value = expression.head.text
  const dependencies = []
  for (const span of expression.templateSpans) {
    const interpolation = evaluateConstantValue(
      span.expression,
      scope,
      resolving,
      referenceScope,
      referencePosition,
      enumBinding,
      depth + 1,
    )
    if (!interpolation) return undefined
    value += String(interpolation.value) + span.literal.text
    dependencies.push(...interpolation.dependencies)
  }
  return { value, dependencies }
}

function evaluateBinaryValue(
  expression,
  scope,
  resolving,
  referenceScope,
  referencePosition,
  enumBinding,
  depth,
) {
  const left = evaluateConstantValue(
    expression.left,
    scope,
    resolving,
    referenceScope,
    referencePosition,
    enumBinding,
    depth + 1,
  )
  if (!left) return undefined

  const operator = expression.operatorToken.kind
  const resolver = BINARY_VALUE_RESOLVERS.get(operator)
  if (!resolver) return undefined
  const shortCircuitValue = resolver(left.value, undefined)
  if (shortCircuitValue !== undefined && operator !== SyntaxKind.PlusToken) return left

  const right = evaluateConstantValue(
    expression.right,
    scope,
    resolving,
    referenceScope,
    referencePosition,
    enumBinding,
    depth + 1,
  )
  if (!right) return undefined
  return {
    value: resolver(left.value, right.value),
    dependencies: [...left.dependencies, ...right.dependencies],
  }
}

function evaluateConstantBindingValue(binding, resolving, depth) {
  // Bindings are stable identities, so aliases keep the declaration-time
  // environment even when the same name is shadowed at a later use site.
  if (binding.cachedValue !== undefined) return binding.cachedValue
  if (resolving.has(binding) || depth > MAX_CONSTANT_EVALUATION_DEPTH) return undefined

  const nextResolving = new Set(resolving).add(binding)
  const result = evaluateConstantValue(
    binding.initializer,
    binding.scope,
    nextResolving,
    binding.scope,
    binding.initializer.getStart(),
    undefined,
    depth + 1,
  )
  binding.cachedValue = result ?? null
  return result
}

function evaluateMutableBindingValue(
  binding,
  resolving,
  referenceScope,
  referencePosition,
  depth,
) {
  if (resolving.has(binding) || depth > MAX_CONSTANT_EVALUATION_DEPTH) return undefined

  const writes = (binding.writes ?? []).filter((write) => write.isReachable)
  if (writes.length > 1) return undefined
  if (writes.length === 0) {
    return evaluateMutableInitializerValue(
      binding,
      resolving,
      referenceScope,
      referencePosition,
      depth + 1,
    )
  }
  return evaluateMutableAssignmentValue(
    binding,
    writes[0],
    resolving,
    referenceScope,
    referencePosition,
    depth + 1,
  )
}

function evaluateMutableInitializerValue(
  binding,
  resolving,
  referenceScope,
  referencePosition,
  depth,
) {
  if (!binding.initializer) return undefined
  if (referencePosition < binding.initializer.getStart()) return undefined
  if (!isBindingAvailable(binding, referencePosition)) return undefined
  const nextResolving = new Set(resolving).add(binding)
  const result = evaluateConstantValue(
    binding.initializer,
    binding.scope,
    nextResolving,
    referenceScope,
    referencePosition,
    undefined,
    depth + 1,
  )
  return result ? { ...result, state: binding.initializer } : undefined
}

function mutableAssignmentIsFoldable(binding, write, referencePosition) {
  if (binding.initializer) return false
  if (write.start < binding.assignmentAvailableAfter) return false
  if (!write.isSimple || write.isUncertain) return false
  if (!write.expression || write.position >= referencePosition) return false
  return !expressionReferencesMutableBinding(write.expression, write.scope)
}

function evaluateMutableAssignmentValue(
  binding,
  write,
  resolving,
  referenceScope,
  referencePosition,
  depth,
) {
  // Rolldown only folds a mutable binding with a single, simple assignment
  // when there was no initializer. Any explicit reassignment invalidates the
  // binding's constant state, including writes after an earlier use.
  if (!mutableAssignmentIsFoldable(binding, write, referencePosition)) return undefined
  const nextResolving = new Set(resolving).add(binding)
  const result = evaluateConstantValue(
    write.expression,
    write.scope,
    nextResolving,
    referenceScope,
    referencePosition,
    undefined,
    depth + 1,
  )
  return result ? { ...result, state: write } : undefined
}

function mutableShadowBlocks(candidate, referencePosition, resolving, depth) {
  if (candidate.mutationPositions.some((position) => position <= referencePosition)) return true
  if (!candidate.initializer) return false
  return !evaluateConstantValue(
    candidate.initializer,
    candidate.scope,
    resolving,
    candidate.scope,
    candidate.initializer.getStart(),
    undefined,
    depth + 1,
  )
}

function regionCandidateBlocks(candidate, dependency, referencePosition, resolving, depth) {
  if (candidate === dependency.binding || !isBindingAvailable(candidate, referencePosition)) {
    return false
  }
  if (candidate.kind === 'constant') {
    return !evaluateConstantBindingValue(candidate, resolving, depth + 1)
  }
  if (candidate.kind === 'mutable') {
    return mutableShadowBlocks(candidate, referencePosition, resolving, depth + 1)
  }
  return candidate.kind === 'barrier' || candidate.kind === 'unknown-shadow'
}

function regionHasBlockingShadow(
  dependency,
  referenceScope,
  referencePosition,
  resolving,
  depth,
) {
  const candidates = referenceScope.region.bindings.get(dependency.name) ?? []
  return candidates.some((candidate) =>
    regionCandidateBlocks(candidate, dependency, referencePosition, resolving, depth + 1),
  )
}

function visibleBindingAllowsCapture(binding, referencePosition, resolving, depth) {
  if (binding.kind === 'constant') {
    // Rolldown eliminates any proven literal shadow before folding the alias;
    // the shadow does not need to have the captured dependency's value.
    return Boolean(evaluateConstantBindingValue(binding, resolving, depth + 1))
  }
  if (binding.kind === 'const-enum' || binding.kind === 'static-shadow') return true
  if (binding.kind !== 'mutable') return false
  return !mutableShadowBlocks(binding, referencePosition, resolving, depth + 1)
}

function dependencyMatchesUseSite(
  dependency,
  referenceScope,
  referencePosition,
  resolving,
  depth,
) {
  if (
    regionHasBlockingShadow(
      dependency,
      referenceScope,
      referencePosition,
      resolving,
      depth + 1,
    )
  ) {
    return false
  }
  const visibleBinding = findBinding(referenceScope, dependency.name)
  if (dependency.binding.kind === 'mutable') {
    return mutableDependencyMatchesUseSite(
      dependency,
      visibleBinding,
      referenceScope,
      referencePosition,
      resolving,
      depth + 1,
    )
  }
  return nonMutableDependencyMatchesUseSite(
    dependency,
    visibleBinding,
    referencePosition,
    resolving,
    depth + 1,
  )
}

function mutableDependencyMatchesUseSite(
  dependency,
  visibleBinding,
  referenceScope,
  referencePosition,
  resolving,
  depth,
) {
  if (visibleBinding !== dependency.binding) return false
  if (!isBindingAvailable(visibleBinding, referencePosition)) return false
  const current = evaluateMutableBindingValue(
    dependency.binding,
    resolving,
    referenceScope,
    referencePosition,
    depth + 1,
  )
  return current?.state === dependency.state && current.value === dependency.value
}

function nonMutableDependencyMatchesUseSite(
  dependency,
  visibleBinding,
  referencePosition,
  resolving,
  depth,
) {
  if (
    !visibleBinding ||
    visibleBinding === dependency.binding ||
    !isBindingAvailable(visibleBinding, referencePosition)
  ) {
    return true
  }
  return visibleBindingAllowsCapture(visibleBinding, referencePosition, resolving, depth + 1)
}

function evaluateConstantBinding(
  expression,
  scope,
  resolving,
  referenceScope,
  referencePosition,
  depth,
) {
  const binding = findBinding(scope, expression.text)
  if (
    !binding ||
    (binding.kind !== 'constant' && binding.kind !== 'mutable') ||
    resolving.has(binding) ||
    !isBindingAvailable(binding, expression.getStart())
  ) {
    return undefined
  }

  const value =
    binding.kind === 'constant'
      ? evaluateConstantBindingValue(binding, resolving, depth + 1)
      : evaluateMutableBindingValue(
          binding,
          resolving,
          referenceScope,
          referencePosition,
          depth + 1,
        )
  if (!value) return undefined
  const dependencies = [
    { name: expression.text, binding, value: value.value, state: value.state },
    ...value.dependencies,
  ]
  if (
    !dependencies.every((dependency) =>
      dependencyMatchesUseSite(
        dependency,
        referenceScope,
        referencePosition,
        resolving,
        depth + 1,
      ),
    )
  ) {
    return undefined
  }
  return { value: value.value, dependencies }
}

function constEnumMemberName(expression) {
  if (isPropertyAccessExpression(expression) && isIdentifier(expression.expression)) {
    return { enumName: expression.expression.text, memberName: expression.name.text }
  }
  if (
    isElementAccessExpression(expression) &&
    isIdentifier(expression.expression) &&
    (isStringLiteral(expression.argumentExpression) ||
      isNumericLiteral(expression.argumentExpression))
  ) {
    return {
      enumName: expression.expression.text,
      memberName: expression.argumentExpression.text,
    }
  }
  return undefined
}

function evaluateImplicitConstEnumMember(binding, descriptor, resolving, depth) {
  if (descriptor.index === 0) return { value: 0, dependencies: [] }
  const previous = binding.memberList[descriptor.index - 1]
  if (!previous) return undefined
  const previousValue = evaluateConstEnumMember(
    binding,
    previous.name,
    resolving,
    depth + 1,
  )
  if (typeof previousValue?.value !== 'number') return undefined
  return {
    value: previousValue.value + 1,
    dependencies: previousValue.dependencies,
  }
}

function evaluateExplicitConstEnumMember(binding, descriptor, resolving, depth) {
  const initializer = descriptor.member.initializer
  return evaluateConstantValue(
    initializer,
    binding.scope,
    resolving,
    binding.scope,
    initializer.getStart(),
    binding,
    depth + 1,
  )
}

function evaluateConstEnumMember(binding, memberName, resolving, depth) {
  if (binding.cachedValues.has(memberName)) {
    return binding.cachedValues.get(memberName) ?? undefined
  }
  const descriptor = binding.members.get(memberName)
  if (
    !descriptor ||
    resolving.has(descriptor) ||
    depth > MAX_CONSTANT_EVALUATION_DEPTH
  ) {
    return undefined
  }

  const nextResolving = new Set(resolving).add(descriptor)
  const result = descriptor.member.initializer
    ? evaluateExplicitConstEnumMember(binding, descriptor, nextResolving, depth + 1)
    : evaluateImplicitConstEnumMember(binding, descriptor, nextResolving, depth + 1)
  binding.cachedValues.set(memberName, result ?? null)
  return result
}

function evaluateConstEnumAccess(expression, scope, resolving, depth) {
  const access = constEnumMemberName(expression)
  if (!access) return undefined
  const binding = findBinding(scope, access.enumName)
  if (!binding || binding.kind !== 'const-enum') return undefined
  const value = evaluateConstEnumMember(binding, access.memberName, resolving, depth + 1)
  if (!value) return undefined
  return {
    value: value.value,
    dependencies: [
      { name: access.enumName, binding, value: value.value },
      ...value.dependencies,
    ],
  }
}

function evaluateLiteralExpression(expression) {
  if (isNumericLiteral(expression)) {
    return { value: Number(expression.text), dependencies: [] }
  }
  return { value: expression.text, dependencies: [] }
}

function evaluateKeywordExpression(expression) {
  const values = new Map([
    [SyntaxKind.TrueKeyword, true],
    [SyntaxKind.FalseKeyword, false],
    [SyntaxKind.NullKeyword, null],
  ])
  return { value: values.get(expression.kind), dependencies: [] }
}

function evaluateWrappedExpression(expression, context) {
  return evaluateConstantValue(
    expression.expression,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.enumBinding,
    context.depth + 1,
  )
}

function evaluateTemplateExpressionValue(expression, context) {
  return evaluateTemplateValue(
    expression,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.enumBinding,
    context.depth,
  )
}

function evaluateConditionalExpressionValue(expression, context) {
  const condition = evaluateConstantValue(
    expression.condition,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.enumBinding,
    context.depth + 1,
  )
  if (!condition) return undefined
  const branch = condition.value ? expression.whenTrue : expression.whenFalse
  const result = evaluateConstantValue(
    branch,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.enumBinding,
    context.depth + 1,
  )
  if (!result) return undefined
  return {
    value: result.value,
    dependencies: [...condition.dependencies, ...result.dependencies],
  }
}

function evaluateBinaryExpressionValue(expression, context) {
  return evaluateBinaryValue(
    expression,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.enumBinding,
    context.depth,
  )
}

function evaluateIdentifierExpressionValue(expression, context) {
  if (context.enumBinding?.members.has(expression.text)) {
    return evaluateConstEnumMember(
      context.enumBinding,
      expression.text,
      context.resolving,
      context.depth + 1,
    )
  }
  return evaluateConstantBinding(
    expression,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.depth,
  )
}

function evaluateConstEnumAccessValue(expression, context) {
  return evaluateConstEnumAccess(
    expression,
    context.scope,
    context.resolving,
    context.depth,
  )
}

const CONSTANT_VALUE_HANDLERS = new Map([
  [SyntaxKind.StringLiteral, evaluateLiteralExpression],
  [SyntaxKind.NoSubstitutionTemplateLiteral, evaluateLiteralExpression],
  [SyntaxKind.NumericLiteral, evaluateLiteralExpression],
  [SyntaxKind.TrueKeyword, evaluateKeywordExpression],
  [SyntaxKind.FalseKeyword, evaluateKeywordExpression],
  [SyntaxKind.NullKeyword, evaluateKeywordExpression],
  [SyntaxKind.ParenthesizedExpression, evaluateWrappedExpression],
  [SyntaxKind.AsExpression, evaluateWrappedExpression],
  [SyntaxKind.NonNullExpression, evaluateWrappedExpression],
  [SyntaxKind.SatisfiesExpression, evaluateWrappedExpression],
  [SyntaxKind.TypeAssertionExpression, evaluateWrappedExpression],
  [SyntaxKind.TemplateExpression, evaluateTemplateExpressionValue],
  [SyntaxKind.ConditionalExpression, evaluateConditionalExpressionValue],
  [SyntaxKind.BinaryExpression, evaluateBinaryExpressionValue],
  [SyntaxKind.Identifier, evaluateIdentifierExpressionValue],
  [SyntaxKind.PropertyAccessExpression, evaluateConstEnumAccessValue],
  [SyntaxKind.ElementAccessExpression, evaluateConstEnumAccessValue],
])

function evaluateConstantValue(
  expression,
  scope,
  resolving = new Set(),
  referenceScope = scope,
  referencePosition = expression?.getStart() ?? 0,
  enumBinding,
  depth = 0,
) {
  if (!expression || depth > MAX_CONSTANT_EVALUATION_DEPTH) return undefined
  const handler = CONSTANT_VALUE_HANDLERS.get(expression.kind)
  if (!handler) return undefined
  return handler(expression, {
    scope,
    resolving,
    referenceScope,
    referencePosition,
    enumBinding,
    depth,
  })
}

function possibleWrappedTarget(expression, context) {
  return expressionMayResolveToReactHotkeys(
    expression.expression,
    context.scope,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.depth + 1,
  )
}

function possibleConditionalTarget(expression, context) {
  return [expression.whenTrue, expression.whenFalse].some((branch) =>
    expressionMayResolveToReactHotkeys(
      branch,
      context.scope,
      context.resolving,
      context.referenceScope,
      context.referencePosition,
      context.depth + 1,
    ),
  )
}

function expressionReferencesMutableBinding(expression, scope) {
  let found = false
  walkAst(expression, (node) => {
    if (!isIdentifier(node)) return
    const binding = findBinding(scope, node.text)
    if (binding?.kind === 'mutable') found = true
  })
  return found
}

function possibleIdentifierTarget(expression, context) {
  const { scope, resolving, referenceScope, referencePosition, depth } = context
  const binding = findBinding(scope, expression.text)
  if (!identifierTargetBindingIsAvailable(binding, resolving, expression.getStart())) {
    return false
  }
  if (binding.kind === 'mutable') {
    return mutableIdentifierTarget(binding, context)
  }
  if (binding.kind !== 'constant') return false
  return constantIdentifierTarget(expression, binding, context)
}

function identifierTargetBindingIsAvailable(binding, resolving, referencePosition) {
  return Boolean(
    binding &&
      !resolving.has(binding) &&
      isBindingAvailable(binding, referencePosition),
  )
}

function mutableIdentifierTarget(binding, context) {
  const value = evaluateMutableBindingValue(
    binding,
    context.resolving,
    context.referenceScope,
    context.referencePosition,
    context.depth + 1,
  )
  return value?.value === REACT_HOTKEYS_HOOK_MODULE
}

function constantIdentifierTarget(expression, binding, context) {
  const value = evaluateConstantBindingValue(binding, context.resolving, context.depth + 1)
  if (value) return constantTargetDependenciesMatch(expression, binding, value, context)
  if (expressionReferencesMutableBinding(binding.initializer, binding.scope)) return false
  const dependency = { name: expression.text, binding }
  if (
    !dependencyMatchesUseSite(
      dependency,
      context.referenceScope,
      context.referencePosition,
      context.resolving,
      context.depth + 1,
    )
  ) {
    return false
  }
  return expressionMayResolveToReactHotkeys(
    binding.initializer,
    binding.scope,
    new Set(context.resolving).add(binding),
    context.referenceScope,
    context.referencePosition,
    context.depth + 1,
  )
}

function constantTargetDependenciesMatch(expression, binding, value, context) {
  if (value.value !== REACT_HOTKEYS_HOOK_MODULE) return false
  const dependencies = [
    { name: expression.text, binding, value: value.value },
    ...value.dependencies,
  ]
  return dependencies.every((dependency) =>
    dependencyMatchesUseSite(
      dependency,
      context.referenceScope,
      context.referencePosition,
      context.resolving,
      context.depth + 1,
    ),
  )
}

const POSSIBLE_TARGET_HANDLERS = new Map([
  [SyntaxKind.ParenthesizedExpression, possibleWrappedTarget],
  [SyntaxKind.AsExpression, possibleWrappedTarget],
  [SyntaxKind.NonNullExpression, possibleWrappedTarget],
  [SyntaxKind.SatisfiesExpression, possibleWrappedTarget],
  [SyntaxKind.TypeAssertionExpression, possibleWrappedTarget],
  [SyntaxKind.ConditionalExpression, possibleConditionalTarget],
  [SyntaxKind.Identifier, possibleIdentifierTarget],
])

function expressionMayResolveToReactHotkeys(
  expression,
  scope,
  resolving = new Set(),
  referenceScope = scope,
  referencePosition = expression?.getStart() ?? 0,
  depth = 0,
) {
  if (!expression || depth > MAX_CONSTANT_EVALUATION_DEPTH) return false
  const exact = evaluateConstantValue(
    expression,
    scope,
    resolving,
    referenceScope,
    referencePosition,
    undefined,
    depth + 1,
  )
  if (exact) return exact.value === REACT_HOTKEYS_HOOK_MODULE
  const handler = POSSIBLE_TARGET_HANDLERS.get(expression.kind)
  if (!handler) return false
  return handler(expression, { scope, resolving, referenceScope, referencePosition, depth })
}

function isReactHotkeysSource(source, scope) {
  return expressionMayResolveToReactHotkeys(source, scope)
}

function hasOnlyTypeSpecifiers(elements) {
  return elements?.length > 0 && elements.every((element) => element.isTypeOnly)
}

function isRuntimeImportDeclaration(node) {
  const clause = node.importClause
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name) return true
  return !hasOnlyTypeSpecifiers(clause.namedBindings?.elements)
}

function isRuntimeExportDeclaration(node) {
  if (node.isTypeOnly) return false
  return !hasOnlyTypeSpecifiers(node.exportClause?.elements)
}

function isStaticReactHotkeysImport(node, scope) {
  const runtimeDeclaration = isImportDeclaration(node)
    ? isRuntimeImportDeclaration(node)
    : isExportDeclaration(node) && isRuntimeExportDeclaration(node)
  return runtimeDeclaration && isReactHotkeysSource(node.moduleSpecifier, scope)
}

function isTypeScriptReactHotkeysImport(node, scope) {
  if (!isImportEqualsDeclaration(node) || node.isTypeOnly) return false
  const reference = node.moduleReference
  return isExternalModuleReference(reference) && isReactHotkeysSource(reference.expression, scope)
}

function isReactHotkeysCallImport(node, scope) {
  if (!isCallExpression(node)) return false
  const { expression, arguments: args } = node
  const isRequire =
    isIdentifier(expression) &&
    expression.text === 'require' &&
    !findLexicalBinding(scope, expression.text)
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

// Most source nodes cannot introduce a runtime module dependency. Keep the
// full AST walk for scope construction, but avoid invoking all three import
// checks for every expression, token wrapper, and declaration in the scan.
const IMPORT_NODE_KINDS = new Set([
  SyntaxKind.ImportDeclaration,
  SyntaxKind.ExportDeclaration,
  SyntaxKind.ImportEqualsDeclaration,
  SyntaxKind.CallExpression,
])

const WRITE_NODE_KINDS = new Set([
  SyntaxKind.BinaryExpression,
  SyntaxKind.PrefixUnaryExpression,
  SyntaxKind.PostfixUnaryExpression,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
])

const TRAVERSAL_NODE_KINDS = new Set([
  ...LEXICAL_SCOPE_KINDS,
  ...LOOP_SCOPE_KINDS,
  ...BINDING_DECLARATION_KINDS,
  ...IMPORT_NODE_KINDS,
  ...WRITE_NODE_KINDS,
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
])

// The TypeScript 7 remote AST stores each node in a fixed-width record. Read
// the traversal links directly so the full-source boundary scan does not
// materialize token and NodeList wrapper objects that it never inspects.
const REMOTE_NODE_LIST_KIND = 0xffffffff
const REMOTE_NODE_KIND_OFFSET = 0
const REMOTE_NODE_NEXT_OFFSET = 12
const REMOTE_NODE_PARENT_OFFSET = 16

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
    if (!project) throw new Error('TypeScript could not create the in-memory boundary project')

    const syntaxErrors = project.program
      .getSyntacticDiagnostics()
      .flatMap((diagnostic) => {
        const candidate = virtualSources.get(diagnostic.fileName)
        const sourceFile = project.program.getSourceFile(diagnostic.fileName)
        if (!candidate || !sourceFile) return []
        const position = Math.min(diagnostic.pos ?? 0, sourceFile.end)
        const location = sourceFile.getLineAndCharacterOfPosition(position)
        return [
          {
            path: candidate.path,
            line: location.line + 1,
            column: location.character + 1,
            code: diagnostic.code,
            text: diagnostic.text ?? 'Invalid TypeScript syntax',
          },
        ]
      })
      .toSorted(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.line - right.line ||
          left.column - right.column ||
          left.code - right.code,
      )
      .filter(
        (diagnostic, index, diagnostics) =>
          index === 0 ||
          diagnostic.path !== diagnostics[index - 1].path ||
          diagnostic.line !== diagnostics[index - 1].line ||
          diagnostic.column !== diagnostics[index - 1].column ||
          diagnostic.code !== diagnostics[index - 1].code,
      )
    if (syntaxErrors.length > 0) {
      throw new SyntaxError(
        `Runtime hotkey import boundary could not parse source:\n${syntaxErrors
          .map(
            ({ path, line, column, code, text }) =>
              `${path}:${line}:${column} TS${code}: ${text}`,
          )
          .join('\n')}`,
      )
    }

    for (const [virtualPath, { path }] of virtualSources) {
      const sourceFile = project?.program.getSourceFile(virtualPath)
      if (!sourceFile) throw new Error(`TypeScript could not parse in-memory source: ${path}`)
      const { importNodes, nodeScopes, sourceScope } = buildLexicalScopes(sourceFile)

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

      for (const node of importNodes) {
        const scope = nodeScopes.get(node) ?? sourceScope
        if (IMPORT_NODE_CHECKS.some((check) => check(node, scope))) record(node)
      }
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
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
