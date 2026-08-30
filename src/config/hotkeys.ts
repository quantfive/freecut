/**
 * Centralized keyboard shortcut configuration
 *
 * Uses `mod` for cross-platform Cmd (Mac) / Ctrl (Windows/Linux) handling.
 * react-hotkeys-hook automatically handles this translation.
 */

export const HOTKEYS = {
  // Playback controls
  PLAY_PAUSE: 'space',
  SHUTTLE_REVERSE: 'j',
  SHUTTLE_PAUSE: 'k',
  SHUTTLE_FORWARD: 'l',
  PREVIOUS_FRAME: 'left',
  NEXT_FRAME: 'right',
  GO_TO_START: 'home',
  GO_TO_END: 'end',
  NEXT_SNAP_POINT: 'down',
  PREVIOUS_SNAP_POINT: 'up',

  // Timeline editing
  SPLIT_AT_PLAYHEAD_ALT: 'alt+c',
  JOIN_ITEMS: 'shift+j',
  DELETE_SELECTED: 'delete',
  DELETE_SELECTED_ALT: 'backspace',
  RIPPLE_DELETE: 'mod+delete',
  RIPPLE_DELETE_ALT: 'mod+backspace',
  FREEZE_FRAME: 'shift+f',
  LINK_AUDIO_VIDEO: 'mod+alt+l',
  UNLINK_AUDIO_VIDEO: 'alt+shift+l',
  TOGGLE_LINKED_SELECTION: 'shift+l',
  NUDGE_LEFT: 'shift+left',
  NUDGE_RIGHT: 'shift+right',
  NUDGE_UP: 'shift+up',
  NUDGE_DOWN: 'shift+down',
  NUDGE_LEFT_LARGE: 'mod+shift+left',
  NUDGE_RIGHT_LARGE: 'mod+shift+right',
  NUDGE_UP_LARGE: 'mod+shift+up',
  NUDGE_DOWN_LARGE: 'mod+shift+down',

  // History
  UNDO: 'mod+z',
  REDO: 'mod+shift+z',

  // Zoom
  ZOOM_IN: 'mod+equal',
  ZOOM_OUT: 'mod+minus',
  ZOOM_TO_FIT: 'backslash',
  ZOOM_TO_100: 'shift+backslash',
  ZOOM_TO_100_ALT: 'mod+0',

  // Clipboard
  COPY: 'mod+c',
  CUT: 'mod+x',
  PASTE: 'mod+v',

  // Tools
  SELECTION_TOOL: 'v',
  TRIM_EDIT_TOOL: 't',
  RAZOR_TOOL: 'shift+c',
  SPLIT_AT_PLAYHEAD: 'c',
  RATE_STRETCH_TOOL: 'r',
  SLIP_TOOL: 'y',
  SLIDE_TOOL: 'u',

  // Project
  SAVE: 'mod+s',
  EXPORT: 'mod+shift+e',

  // UI
  TOGGLE_SNAP: 's',
  TOGGLE_CANVAS_SNAP: 'shift+s',
  OPEN_SCENE_BROWSER: 'mod+shift+f',
  WORKSPACE_EDIT: 'alt+1',
  WORKSPACE_COLOR: 'alt+2',
  WORKSPACE_ANIMATE: 'alt+3',

  // Markers
  ADD_MARKER: 'm',
  REMOVE_MARKER: 'shift+m',
  PREVIOUS_MARKER: 'bracketleft',
  NEXT_MARKER: 'bracketright',

  // Keyframes
  CLEAR_KEYFRAMES: 'shift+a',
  KEYFRAME_EDITOR_GRAPH: '1',
  KEYFRAME_EDITOR_DOPESHEET: '2',
  KEYFRAME_EDITOR_SPLIT: '3',
  EDIT_KEYFRAME_ADD: 'shift+k',
  KEYFRAME_PREVIOUS: 'alt+bracketleft',
  KEYFRAME_NEXT: 'alt+bracketright',
  KEYFRAME_TOGGLE_AUTO: 'a',
  KEYFRAME_FIT: 'f',

  // Source Monitor
  MARK_IN: 'i',
  MARK_OUT: 'o',
  CLEAR_IN_OUT: 'alt+x',
  INSERT_EDIT: 'comma',
  OVERWRITE_EDIT: 'period',
} as const

export type HotkeyKey = keyof typeof HOTKEYS
export type HotkeyBindingMap = Record<HotkeyKey, string>
export type HotkeyOverrideMap = Partial<Record<HotkeyKey, string>>
type HotkeyPlatform = 'mac' | 'windows'

const HOTKEY_COMMAND_ORDER = Object.keys(HOTKEYS) as HotkeyKey[]

export const HOTKEY_EXPORT_SCHEMA = 'freecut-hotkeys'
export const HOTKEY_EXPORT_VERSION = 2

export interface HotkeyExportCommand {
  id: HotkeyKey
  label: string
  binding: string
  defaultBinding: string
  isCustom: boolean
}

export interface HotkeyExportDocument {
  schema: typeof HOTKEY_EXPORT_SCHEMA
  version: typeof HOTKEY_EXPORT_VERSION
  exportedAt: string
  commands: HotkeyExportCommand[]
  overrides: HotkeyOverrideMap
}

interface HotkeyImportCommand {
  id?: string
  key?: string
  label?: string
  binding?: string
  shortcut?: string
  defaultBinding?: string
}

export interface HotkeyImportResult {
  overrides: HotkeyOverrideMap
  importedCommandCount: number
  ignoredCommandCount: number
  remappedCommandCount: number
  sourceVersion: number | null
  conflictWarnings?: HotkeyConflictWarning[]
}

export interface HotkeyConflictWarning {
  code: 'duplicate_binding'
  command: HotkeyKey
  binding: string
  resolution: 'fallback' | 'unassigned'
  conflictingCommand: HotkeyKey
}

export interface HotkeyResolution {
  bindings: HotkeyBindingMap
  overrides: HotkeyOverrideMap
  warnings: HotkeyConflictWarning[]
}

type RuntimeHotkeyVariant = 'primary' | 'preview'

interface RuntimeHotkeyClaim {
  command: HotkeyKey
  binding: string
  variant: RuntimeHotkeyVariant
}

interface RuntimePhysicalHotkeyClaim extends RuntimeHotkeyClaim {
  physicalBinding: string
}

export interface BrowserHostileHotkey {
  binding: string
  browserAction: string
}

interface HotkeyCommandLookup {
  byLabel: Map<string, HotkeyKey>
  byDefaultBinding: Map<string, HotkeyKey>
}

const HOTKEY_MODIFIERS = ['mod', 'ctrl', 'meta', 'alt', 'shift'] as const
const HOTKEY_MODIFIER_SET = new Set<string>(HOTKEY_MODIFIERS)
const HOTKEY_MODIFIER_ORDER = new Map<string, number>(
  HOTKEY_MODIFIERS.map((token, index) => [token, index]),
)

const HOTKEY_TOKEN_ALIASES: Record<string, string> = {
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  option: 'alt',
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  '=': 'equal',
  equals: 'equal',
  '-': 'minus',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
}

const HOTKEY_KEY_LABELS: Record<string, string> = {
  space: 'Space',
  comma: ',',
  period: '.',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '=',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  home: 'Home',
  end: 'End',
  delete: 'Delete',
  backspace: 'Backspace',
  escape: 'Esc',
  tab: 'Tab',
  enter: 'Enter',
}

const HOTKEY_MODIFIER_LABELS: Record<HotkeyPlatform, Record<string, string>> = {
  mac: {
    mod: 'Cmd',
    ctrl: 'Ctrl',
    meta: 'Cmd',
    alt: 'Option',
    shift: 'Shift',
  },
  windows: {
    mod: 'Ctrl',
    ctrl: 'Ctrl',
    meta: 'Meta',
    alt: 'Alt',
    shift: 'Shift',
  },
}

const HOTKEY_CODE_TOKEN_MAP: Record<string, string> = {
  Space: 'space',
  Comma: 'comma',
  Period: 'period',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Minus: 'minus',
  Equal: 'equal',
  Slash: 'slash',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Backquote: 'backquote',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  Delete: 'delete',
  Backspace: 'backspace',
  Escape: 'escape',
  Tab: 'tab',
  Enter: 'enter',
}

const HOTKEY_COMMAND_ALIASES: Partial<Record<string, HotkeyKey>> = {
  SPLIT_AT_CURSOR: 'SPLIT_AT_PLAYHEAD',
}

const LEGACY_HOTKEY_LABELS: Record<string, HotkeyKey> = {
  'razor tool': 'RAZOR_TOOL',
}

const BROWSER_HOSTILE_HOTKEYS: readonly BrowserHostileHotkey[] = [
  { binding: 'alt+left', browserAction: 'Back navigation' },
  { binding: 'alt+right', browserAction: 'Forward navigation' },
  { binding: 'f5', browserAction: 'Reload page' },
  { binding: 'mod+r', browserAction: 'Reload page' },
  { binding: 'mod+shift+r', browserAction: 'Hard reload page' },
  { binding: 'mod+t', browserAction: 'New tab' },
  { binding: 'mod+shift+t', browserAction: 'Reopen closed tab' },
  { binding: 'mod+w', browserAction: 'Close tab' },
  { binding: 'mod+n', browserAction: 'New window' },
  { binding: 'mod+shift+n', browserAction: 'New private window' },
  { binding: 'mod+l', browserAction: 'Focus address bar' },
  {
    binding: 'mod+shift+l',
    browserAction: 'Focus address bar or search in some browsers',
  },
  { binding: 'mod+d', browserAction: 'Bookmark page or focus address bar' },
  {
    binding: 'mod+e',
    browserAction: 'Focus search or address bar in some browsers',
  },
  { binding: 'mod+p', browserAction: 'Print page' },
  { binding: 'mod+f', browserAction: 'Find in page' },
  { binding: 'mod+equal', browserAction: 'Browser zoom in' },
  { binding: 'mod+minus', browserAction: 'Browser zoom out' },
  { binding: 'mod+0', browserAction: 'Reset browser zoom' },
  { binding: 'mod+1', browserAction: 'Switch to tab 1' },
  { binding: 'mod+2', browserAction: 'Switch to tab 2' },
  { binding: 'mod+3', browserAction: 'Switch to tab 3' },
  { binding: 'mod+4', browserAction: 'Switch to tab 4' },
  { binding: 'mod+5', browserAction: 'Switch to tab 5' },
  { binding: 'mod+6', browserAction: 'Switch to tab 6' },
  { binding: 'mod+7', browserAction: 'Switch to tab 7' },
  { binding: 'mod+8', browserAction: 'Switch to tab 8' },
  { binding: 'mod+9', browserAction: 'Switch to last tab' },
] as const

const BROWSER_HOSTILE_HOTKEY_MAP = new Map(
  BROWSER_HOSTILE_HOTKEYS.map((entry) => [entry.binding, entry]),
)

export interface HotkeyEventData {
  key?: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * Human-readable descriptions for keyboard shortcuts.
 * Used for tooltips, help dialogs, and documentation.
 */
export const HOTKEY_DESCRIPTIONS: Record<HotkeyKey, string> = {
  // Playback
  PLAY_PAUSE: 'Play/Pause',
  SHUTTLE_REVERSE: 'Shuttle reverse',
  SHUTTLE_PAUSE: 'Pause transport',
  SHUTTLE_FORWARD: 'Shuttle forward',
  PREVIOUS_FRAME: 'Previous frame',
  NEXT_FRAME: 'Next frame',
  GO_TO_START: 'Go to start',
  GO_TO_END: 'Go to end',
  NEXT_SNAP_POINT: 'Next snap point',
  PREVIOUS_SNAP_POINT: 'Previous snap point',

  // Timeline editing
  SPLIT_AT_PLAYHEAD_ALT: 'Split all items at playhead',
  JOIN_ITEMS: 'Join selected clips',
  DELETE_SELECTED: 'Delete selected items',
  DELETE_SELECTED_ALT: 'Delete selected items (alternative)',
  RIPPLE_DELETE: 'Ripple delete selected items',
  RIPPLE_DELETE_ALT: 'Ripple delete selected items (alternative)',
  FREEZE_FRAME: 'Insert freeze frame at playhead',
  LINK_AUDIO_VIDEO: 'Link selected clips',
  UNLINK_AUDIO_VIDEO: 'Unlink selected clips',
  TOGGLE_LINKED_SELECTION: 'Toggle linked selection',
  NUDGE_LEFT: 'Nudge selected visual items left (1px)',
  NUDGE_RIGHT: 'Nudge selected visual items right (1px)',
  NUDGE_UP: 'Nudge selected visual items up (1px)',
  NUDGE_DOWN: 'Nudge selected visual items down (1px)',
  NUDGE_LEFT_LARGE: 'Nudge selected visual items left (10px)',
  NUDGE_RIGHT_LARGE: 'Nudge selected visual items right (10px)',
  NUDGE_UP_LARGE: 'Nudge selected visual items up (10px)',
  NUDGE_DOWN_LARGE: 'Nudge selected visual items down (10px)',

  // History
  UNDO: 'Undo',
  REDO: 'Redo',

  // Zoom
  ZOOM_IN: 'Zoom in timeline',
  ZOOM_OUT: 'Zoom out timeline',
  ZOOM_TO_FIT: 'Zoom to fit all content',
  ZOOM_TO_100: 'Zoom to 100% at cursor or playhead',
  ZOOM_TO_100_ALT: 'Zoom to 100% at cursor or playhead (alternative)',

  // Clipboard
  COPY: 'Copy selected items or keyframes',
  CUT: 'Cut selected items or keyframes',
  PASTE: 'Paste items or keyframes',

  // Tools
  SELECTION_TOOL: 'Selection tool',
  TRIM_EDIT_TOOL: 'Trim edit tool',
  RAZOR_TOOL: 'Razor tool (persistent)',
  SPLIT_AT_PLAYHEAD: 'Split hovered clip at pointer',
  RATE_STRETCH_TOOL: 'Rate stretch tool',
  SLIP_TOOL: 'Slip tool',
  SLIDE_TOOL: 'Slide tool',

  // Project
  SAVE: 'Save project',
  EXPORT: 'Export video',

  // UI
  TOGGLE_SNAP: 'Toggle snap',
  TOGGLE_CANVAS_SNAP: 'Toggle canvas (gizmo) snap',
  OPEN_SCENE_BROWSER: 'Open Scene Browser (search AI captions)',
  WORKSPACE_EDIT: 'Switch to Edit workspace',
  WORKSPACE_COLOR: 'Switch to Color workspace',
  WORKSPACE_ANIMATE: 'Switch to Motion workspace',

  // Markers
  ADD_MARKER: 'Add marker at playhead',
  REMOVE_MARKER: 'Remove selected marker',
  PREVIOUS_MARKER: 'Jump to previous marker',
  NEXT_MARKER: 'Jump to next marker',

  // Keyframes
  CLEAR_KEYFRAMES: 'Clear all keyframes from selected items',
  KEYFRAME_EDITOR_GRAPH: 'Switch keyframe editor to graph view',
  KEYFRAME_EDITOR_DOPESHEET: 'Switch keyframe editor to dopesheet view',
  KEYFRAME_EDITOR_SPLIT: 'Switch keyframe editor to split view',
  EDIT_KEYFRAME_ADD: 'Add keyframe at playhead for selected Edit layer',
  KEYFRAME_PREVIOUS: 'Jump to previous property keyframe',
  KEYFRAME_NEXT: 'Jump to next property keyframe',
  KEYFRAME_TOGGLE_AUTO: 'Toggle auto-key for active property',
  KEYFRAME_FIT: 'Fit selected keyframes in view',

  // Source Monitor
  MARK_IN: 'Mark In point',
  MARK_OUT: 'Mark Out point',
  CLEAR_IN_OUT: 'Clear In/Out points',
  INSERT_EDIT: 'Insert edit',
  OVERWRITE_EDIT: 'Overwrite edit',
}

const HOTKEY_COMMAND_LOOKUP = createHotkeyCommandLookup()

function getNavigatorPlatform(): string {
  if (typeof navigator === 'undefined') return 'Windows'

  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string }
    }
  ).userAgentData

  if (typeof userAgentData?.platform === 'string') {
    return userAgentData.platform
  }

  return navigator.platform || navigator.userAgent || 'Windows'
}

function getHotkeyPlatform(platformValue?: string): HotkeyPlatform {
  const platform = (platformValue ?? getNavigatorPlatform()).toLowerCase()
  return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad')
    ? 'mac'
    : 'windows'
}

export function resolveHotkeyConfiguration(overrides: unknown = {}): HotkeyResolution {
  const requested = sanitizeHotkeyOverrides(overrides)
  const commandKeys = Object.keys(HOTKEYS) as HotkeyKey[]
  const rejectedOverrides = new Set<HotkeyKey>()
  let bindings = createResolvedHotkeyBindings(commandKeys, requested, rejectedOverrides)
  const warnings: HotkeyConflictWarning[] = []

  // Resolve the complete candidate map before assigning priority. This accepts
  // valid swaps (for example Space <-> K), while any remaining collision rejects
  // the participating custom binding(s) back to their unique canonical defaults.
  // Re-run because one fallback can expose a collision with another custom value.
  while (true) {
    const conflicts = getDuplicateRuntimeHotkeyGroups(bindings)
    if (conflicts.length === 0) break

    const passWarnings = createConflictFallbackWarnings(conflicts, requested, rejectedOverrides)
    if (passWarnings.length === 0) {
      throw new Error('Default keyboard shortcut bindings must be unique')
    }
    for (const warning of passWarnings) rejectedOverrides.add(warning.command)
    warnings.push(...passWarnings)
    bindings = createResolvedHotkeyBindings(commandKeys, requested, rejectedOverrides)
  }

  return { bindings, overrides: getEffectiveHotkeyOverrides(bindings), warnings }
}

function createResolvedHotkeyBindings(
  commandKeys: HotkeyKey[],
  requested: HotkeyOverrideMap,
  rejected: Set<HotkeyKey>,
): HotkeyBindingMap {
  return Object.fromEntries(
    commandKeys.map((key) => [
      key,
      !rejected.has(key) && key in requested ? requested[key]! : HOTKEYS[key],
    ]),
  ) as HotkeyBindingMap
}

function getDuplicateRuntimeHotkeyGroups(bindings: HotkeyBindingMap): RuntimeHotkeyClaim[][] {
  const duplicateGroups = new Map<string, RuntimeHotkeyClaim[]>()
  for (const claims of Object.values(getRuntimeHotkeyConflictGraph(bindings))) {
    if (new Set(claims.map((claim) => claim.command)).size < 2) continue
    const signature = claims
      .map((claim) => `${claim.command}:${claim.variant}:${claim.binding}`)
      .sort()
      .join('|')
    if (!duplicateGroups.has(signature)) duplicateGroups.set(signature, claims)
  }
  return [...duplicateGroups.values()]
}

function createConflictFallbackWarnings(
  conflicts: RuntimeHotkeyClaim[][],
  requested: HotkeyOverrideMap,
  rejected: Set<HotkeyKey>,
): HotkeyConflictWarning[] {
  return conflicts.flatMap((claims) => {
    const commands = [...new Set(claims.map((claim) => claim.command))]
    return commands
      .filter((key) => !rejected.has(key) && key in requested && requested[key] !== HOTKEYS[key])
      .map((key) => ({
        code: 'duplicate_binding' as const,
        command: key,
        binding: claims.find((claim) => claim.command === key)!.binding,
        resolution: 'fallback' as const,
        conflictingCommand: commands.find((command) => command !== key)!,
      }))
  })
}

function getEffectiveHotkeyOverrides(bindings: HotkeyBindingMap): HotkeyOverrideMap {
  return Object.fromEntries(
    (Object.keys(HOTKEYS) as HotkeyKey[])
      .filter((key) => bindings[key] !== HOTKEYS[key])
      .map((key) => [key, bindings[key]]),
  )
}

export function resolveHotkeys(overrides: HotkeyOverrideMap = {}): HotkeyBindingMap {
  return resolveHotkeyConfiguration(overrides).bindings
}

function isExplicitlyUnassignedHotkey(rawBinding: string): boolean {
  return rawBinding.trim() === ''
}

function isHotkeyKey(value: string): value is HotkeyKey {
  return value in HOTKEYS
}

function resolveHotkeyKey(value: string): HotkeyKey | null {
  if (isHotkeyKey(value)) {
    return value
  }

  return HOTKEY_COMMAND_ALIASES[value] ?? null
}

function normalizeHotkeyCommandLabel(label: string): string {
  return label.trim().toLowerCase()
}

function resolveLegacyHotkeyImportCommand(command: HotkeyImportCommand): HotkeyKey | null {
  if (typeof command.label !== 'string') return null

  const normalizedLabel = normalizeHotkeyCommandLabel(command.label)
  const legacyLabelMatch = LEGACY_HOTKEY_LABELS[normalizedLabel]
  if (legacyLabelMatch) return legacyLabelMatch

  // Both split commands historically exported the same label. Use the old
  // default binding to preserve the command when an older preset omitted its
  // command id but retained metadata.
  if (normalizedLabel !== 'split at playhead') return null

  const legacyDefault = normalizeHotkeyBinding(command.defaultBinding ?? '')
  return legacyDefault === normalizeHotkeyBinding(HOTKEYS.SPLIT_AT_PLAYHEAD_ALT)
    ? 'SPLIT_AT_PLAYHEAD_ALT'
    : 'SPLIT_AT_PLAYHEAD'
}

function createHotkeyCommandLookup(): HotkeyCommandLookup {
  const byLabel = new Map<string, HotkeyKey>()
  const byDefaultBinding = new Map<string, HotkeyKey>()

  for (const key of Object.keys(HOTKEYS) as HotkeyKey[]) {
    byLabel.set(normalizeHotkeyCommandLabel(HOTKEY_DESCRIPTIONS[key]), key)
    byDefaultBinding.set(normalizeHotkeyBinding(HOTKEYS[key]), key)
  }

  return {
    byLabel,
    byDefaultBinding,
  }
}

// Legacy preset metadata has to distinguish the two historical split commands.
// fallow-ignore-next-line complexity
function resolveHotkeyImportCommand(command: HotkeyImportCommand): {
  key: HotkeyKey | null
  wasRemapped: boolean
} {
  const rawKey =
    typeof command.id === 'string'
      ? command.id
      : typeof command.key === 'string'
        ? command.key
        : null

  if (rawKey) {
    const directKey = resolveHotkeyKey(rawKey)
    if (directKey) {
      return {
        key: directKey,
        wasRemapped: directKey !== rawKey,
      }
    }
  }

  if (typeof command.label === 'string') {
    const legacyCommand = resolveLegacyHotkeyImportCommand(command)
    if (legacyCommand) {
      return {
        key: legacyCommand,
        wasRemapped: true,
      }
    }

    const labelMatch = HOTKEY_COMMAND_LOOKUP.byLabel.get(normalizeHotkeyCommandLabel(command.label))
    if (labelMatch) {
      return {
        key: labelMatch,
        wasRemapped: true,
      }
    }
  }

  if (typeof command.defaultBinding === 'string') {
    const normalizedDefaultBinding = normalizeHotkeyBinding(command.defaultBinding)
    const bindingMatch = HOTKEY_COMMAND_LOOKUP.byDefaultBinding.get(normalizedDefaultBinding)
    if (bindingMatch) {
      return {
        key: bindingMatch,
        wasRemapped: true,
      }
    }
  }

  return {
    key: null,
    wasRemapped: false,
  }
}

function normalizeHotkeyToken(token: string): string {
  const normalized = token.trim().toLowerCase()
  if (!normalized) return ''
  return HOTKEY_TOKEN_ALIASES[normalized] ?? normalized
}

export function splitHotkeyBinding(binding: string): string[] {
  return binding
    .split('+')
    .map((token) => normalizeHotkeyToken(token))
    .filter(Boolean)
}

export function normalizeHotkeyBinding(binding: string): string {
  const modifiers = new Set<string>()
  const keys: string[] = []

  for (const token of splitHotkeyBinding(binding)) {
    if (HOTKEY_MODIFIER_SET.has(token)) {
      modifiers.add(token)
      continue
    }

    if (!keys.includes(token)) {
      keys.push(token)
    }
  }

  const orderedModifiers = Array.from(modifiers).sort((left, right) => {
    return (HOTKEY_MODIFIER_ORDER.get(left) ?? 99) - (HOTKEY_MODIFIER_ORDER.get(right) ?? 99)
  })

  return [...orderedModifiers, ...keys].join('+')
}

export function sanitizeHotkeyOverrides(overrides: unknown): HotkeyOverrideMap {
  if (!overrides || typeof overrides !== 'object') {
    return {}
  }

  const normalizedOverrides: HotkeyOverrideMap = {}

  for (const [rawKey, rawBinding] of Object.entries(overrides)) {
    const key = resolveHotkeyKey(rawKey)
    if (!key || typeof rawBinding !== 'string') {
      continue
    }

    if (isExplicitlyUnassignedHotkey(rawBinding)) {
      normalizedOverrides[key] = ''
      continue
    }

    const normalizedBinding = normalizeHotkeyBinding(rawBinding)
    if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
      continue
    }

    if (normalizedBinding === HOTKEYS[key]) {
      continue
    }

    normalizedOverrides[key] = normalizedBinding
  }

  return normalizedOverrides
}

export function hasHotkeyPrimaryToken(binding: string): boolean {
  return splitHotkeyBinding(binding).some((token) => !HOTKEY_MODIFIER_SET.has(token))
}

function formatHotkeyToken(token: string, platform: HotkeyPlatform): string {
  const modifierLabel = HOTKEY_MODIFIER_LABELS[platform][token]
  if (modifierLabel) return modifierLabel

  if (HOTKEY_KEY_LABELS[token]) {
    return HOTKEY_KEY_LABELS[token]
  }

  if (/^[a-z]$/.test(token)) {
    return token.toUpperCase()
  }

  return token
}

export function formatHotkeyBinding(binding: string, platformValue?: string): string {
  const normalizedBinding = normalizeHotkeyBinding(binding)
  if (!normalizedBinding) return ''

  const platform = getHotkeyPlatform(platformValue)
  return normalizedBinding
    .split('+')
    .map((token) => formatHotkeyToken(token, platform))
    .join(' + ')
}

export function getBrowserHostileHotkey(binding: string): BrowserHostileHotkey | null {
  const normalizedBinding = normalizeHotkeyBinding(binding)
  if (!normalizedBinding) {
    return null
  }

  const directMatch = BROWSER_HOSTILE_HOTKEY_MAP.get(normalizedBinding)
  if (directMatch) return directMatch

  const portableModifierBinding = normalizeHotkeyBinding(
    splitHotkeyBinding(normalizedBinding)
      .map((token) => (token === 'ctrl' || token === 'meta' ? 'mod' : token))
      .join('+'),
  )
  return BROWSER_HOSTILE_HOTKEY_MAP.get(portableModifierBinding) ?? null
}

export function getHotkeyPrimaryTokenFromEventData(eventData: HotkeyEventData): string | null {
  const code = eventData.code ?? ''
  if (HOTKEY_CODE_TOKEN_MAP[code]) {
    return HOTKEY_CODE_TOKEN_MAP[code]
  }

  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toLowerCase()
  }

  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5)
  }

  if (code.startsWith('Numpad') && code.length === 7) {
    return code.slice(6)
  }

  const key = normalizeHotkeyToken(eventData.key ?? '')
  if (!key || HOTKEY_MODIFIER_SET.has(key)) {
    return null
  }

  if (key.length === 1 && /^[a-z0-9]$/.test(key)) {
    return key
  }

  return HOTKEY_KEY_LABELS[key] ? key : null
}

export function getHotkeyBindingFromEventData(eventData: HotkeyEventData): string | null {
  const tokens: string[] = []

  if (eventData.ctrlKey || eventData.metaKey) {
    tokens.push('mod')
  }

  if (eventData.altKey) {
    tokens.push('alt')
  }

  if (eventData.shiftKey) {
    tokens.push('shift')
  }

  const primaryToken = getHotkeyPrimaryTokenFromEventData(eventData)
  if (primaryToken) {
    tokens.push(primaryToken)
  }

  if (tokens.length === 0) {
    return null
  }

  return normalizeHotkeyBinding(tokens.join('+'))
}

/** Exact runtime matching for local handlers, including explicit meta/ctrl remaps. */
export function doesHotkeyEventMatchBinding(eventData: HotkeyEventData, binding: string): boolean {
  const tokens = splitHotkeyBinding(binding)
  const eventKey = eventData.code ?? eventData.key ?? ''
  const functionKey = /^F(?:[1-9]|1[0-2])$/i.test(eventKey) ? eventKey.toLowerCase() : null
  const primaryToken = getHotkeyPrimaryTokenFromEventData(eventData) ?? functionKey
  if (!primaryToken || !tokens.includes(primaryToken)) return false

  const usesMod = tokens.includes('mod')
  const expectsCtrl = tokens.includes('ctrl')
  const expectsMeta = tokens.includes('meta')
  const controlModifierMatches = usesMod
    ? Boolean(eventData.ctrlKey || eventData.metaKey)
    : Boolean(eventData.ctrlKey) === expectsCtrl && Boolean(eventData.metaKey) === expectsMeta

  return (
    controlModifierMatches &&
    Boolean(eventData.altKey) === tokens.includes('alt') &&
    Boolean(eventData.shiftKey) === tokens.includes('shift')
  )
}

function addShiftModifier(binding: string): string {
  const tokens = splitHotkeyBinding(binding)
  if (tokens.includes('shift')) return normalizeHotkeyBinding(binding)
  const key = tokens.pop()
  if (!key) return ''
  return normalizeHotkeyBinding([...tokens, 'shift', key].join('+'))
}

function getCommandRuntimeHotkeyClaims(command: HotkeyKey, binding: string): RuntimeHotkeyClaim[] {
  const normalizedBinding = normalizeHotkeyBinding(binding)
  if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) return []

  const claims: RuntimeHotkeyClaim[] = [{ command, binding: normalizedBinding, variant: 'primary' }]
  if (command === 'MARK_IN' || command === 'MARK_OUT') {
    const previewBinding = addShiftModifier(normalizedBinding)
    if (previewBinding) {
      claims.push({ command, binding: previewBinding, variant: 'preview' })
    }
  }
  return claims
}

function getPhysicalHotkeyBindings(binding: string): string[] {
  const tokens = splitHotkeyBinding(binding)
  return (['mac', 'windows'] as const).map((platform) => {
    const physicalTokens = tokens.map((token) => {
      if (token !== 'mod') return token
      return platform === 'mac' ? 'meta' : 'ctrl'
    })
    return `${platform}:${normalizeHotkeyBinding(physicalTokens.join('+'))}`
  })
}

/**
 * Canonical graph of every physical chord registered at runtime, including
 * modifier-derived variants. Ownership follows HOTKEYS declaration order,
 * with each command's primary claim before its derived preview claim. This
 * order is independent of persisted/host object insertion order so defensive
 * runtime claiming stays stable even for invalid external state.
 */
function getRuntimeHotkeyConflictGraph(
  bindings: HotkeyBindingMap,
): Record<string, RuntimePhysicalHotkeyClaim[]> {
  const conflicts: Record<string, RuntimePhysicalHotkeyClaim[]> = {}

  for (const key of HOTKEY_COMMAND_ORDER) {
    const binding = bindings[key]
    for (const claim of getCommandRuntimeHotkeyClaims(key, binding)) {
      for (const physicalBinding of getPhysicalHotkeyBindings(claim.binding)) {
        const bindingClaims = conflicts[physicalBinding] ?? []
        bindingClaims.push({ ...claim, physicalBinding })
        conflicts[physicalBinding] = bindingClaims
      }
    }
  }

  return conflicts
}

/**
 * Runtime ownership graph containing only live candidates. Each primary or
 * derived candidate acquires every platform alias as one transaction. A
 * collision with any earlier live candidate rejects the whole candidate and
 * leaves every one of its aliases available to later declarations.
 */
function getOwnedRuntimeHotkeyConflictGraph(
  bindings: HotkeyBindingMap,
): Record<string, RuntimePhysicalHotkeyClaim[]> {
  const owned: Record<string, RuntimePhysicalHotkeyClaim[]> = {}

  for (const command of HOTKEY_COMMAND_ORDER) {
    for (const claim of getCommandRuntimeHotkeyClaims(command, bindings[command])) {
      const physicalBindings = getPhysicalHotkeyBindings(claim.binding)
      if (physicalBindings.some((physicalBinding) => owned[physicalBinding]?.length)) continue

      for (const physicalBinding of physicalBindings) {
        owned[physicalBinding] = [{ ...claim, physicalBinding }]
      }
    }
  }

  return owned
}

function getOwnedRuntimeHotkeyBinding(
  graph: Record<string, RuntimePhysicalHotkeyClaim[]>,
  bindings: HotkeyBindingMap,
  command: HotkeyKey,
  variant: RuntimeHotkeyVariant,
): string | null {
  const claim = getCommandRuntimeHotkeyClaims(command, bindings[command]).find(
    (candidate) => candidate.variant === variant,
  )
  if (!claim) return null

  const ownsEveryPhysicalBinding = getPhysicalHotkeyBindings(claim.binding).every((binding) => {
    const owner = graph[binding]?.[0]
    return owner?.command === command && owner.variant === variant
  })
  return ownsEveryPhysicalBinding ? claim.binding : null
}

/**
 * Returns the runtime-only primary registration map. A command that loses any
 * canonical physical alias is disabled with an empty binding; raw resolved and
 * persisted settings are never mutated.
 */
export function resolveRuntimeHotkeys(bindings: HotkeyBindingMap): HotkeyBindingMap {
  const graph = getOwnedRuntimeHotkeyConflictGraph(bindings)
  return Object.fromEntries(
    HOTKEY_COMMAND_ORDER.map((command) => [
      command,
      getOwnedRuntimeHotkeyBinding(graph, bindings, command, 'primary') ?? '',
    ]),
  ) as HotkeyBindingMap
}

export function getRuntimeHotkeyBinding(
  bindings: HotkeyBindingMap,
  command: HotkeyKey,
  variant: RuntimeHotkeyVariant = 'primary',
): string | null {
  const graph = getOwnedRuntimeHotkeyConflictGraph(bindings)
  return getOwnedRuntimeHotkeyBinding(graph, bindings, command, variant)
}

export function findHotkeyConflicts(
  bindings: HotkeyBindingMap,
  binding: string,
  currentKey?: HotkeyKey,
): HotkeyKey[] {
  const normalizedBinding = normalizeHotkeyBinding(binding)
  if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
    return []
  }

  if (!currentKey) {
    const graph = getRuntimeHotkeyConflictGraph(bindings)
    return [
      ...new Set(
        getPhysicalHotkeyBindings(normalizedBinding).flatMap((physicalBinding) =>
          (graph[physicalBinding] ?? []).map((claim) => claim.command),
        ),
      ),
    ]
  }

  const candidateBindings = { ...bindings, [currentKey]: normalizedBinding }
  const graph = getRuntimeHotkeyConflictGraph(candidateBindings)
  const conflicts = new Set<HotkeyKey>()
  for (const claim of getCommandRuntimeHotkeyClaims(currentKey, normalizedBinding)) {
    for (const physicalBinding of getPhysicalHotkeyBindings(claim.binding)) {
      for (const candidate of graph[physicalBinding] ?? []) {
        if (candidate.command !== currentKey) conflicts.add(candidate.command)
      }
    }
  }
  return (Object.keys(HOTKEYS) as HotkeyKey[]).filter((key) => conflicts.has(key))
}

export function createHotkeyExportDocument(
  overrides: HotkeyOverrideMap = {},
): HotkeyExportDocument {
  const normalizedOverrides = resolveHotkeyConfiguration(overrides).overrides
  const bindings = resolveHotkeys(normalizedOverrides)
  const commandKeys = Object.keys(HOTKEYS) as HotkeyKey[]

  return {
    schema: HOTKEY_EXPORT_SCHEMA,
    version: HOTKEY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    commands: commandKeys.map((key) => ({
      id: key,
      label: HOTKEY_DESCRIPTIONS[key],
      binding: bindings[key],
      defaultBinding: HOTKEYS[key],
      isCustom: key in normalizedOverrides,
    })),
    overrides: normalizedOverrides,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function getImportBinding(command: HotkeyImportCommand): string | null {
  if (typeof command.binding === 'string') {
    return command.binding
  }

  if (typeof command.shortcut === 'string') {
    return command.shortcut
  }

  return null
}

function collectImportedOverrides(source: unknown): HotkeyImportResult {
  if (!isRecord(source)) {
    return {
      overrides: {},
      importedCommandCount: 0,
      ignoredCommandCount: 0,
      remappedCommandCount: 0,
      sourceVersion: null,
    }
  }

  const normalizedOverrides: HotkeyOverrideMap = {}
  let importedCommandCount = 0
  let ignoredCommandCount = 0
  let remappedCommandCount = 0

  for (const [rawKey, rawBinding] of Object.entries(source)) {
    const resolvedKey = resolveHotkeyKey(rawKey)
    if (!resolvedKey || typeof rawBinding !== 'string') {
      ignoredCommandCount += 1
      continue
    }

    const normalizedBinding = normalizeHotkeyBinding(rawBinding)
    if (isExplicitlyUnassignedHotkey(rawBinding)) {
      normalizedOverrides[resolvedKey] = ''
      importedCommandCount += 1
      if (resolvedKey !== rawKey) {
        remappedCommandCount += 1
      }
      continue
    }

    if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
      ignoredCommandCount += 1
      continue
    }

    importedCommandCount += 1
    if (resolvedKey !== rawKey) {
      remappedCommandCount += 1
    }

    if (normalizedBinding !== HOTKEYS[resolvedKey]) {
      normalizedOverrides[resolvedKey] = normalizedBinding
    }
  }

  return {
    overrides: normalizedOverrides,
    importedCommandCount,
    ignoredCommandCount,
    remappedCommandCount,
    sourceVersion: null,
  }
}

function resolveHotkeyImportResult(result: HotkeyImportResult): HotkeyImportResult {
  const resolution = resolveHotkeyConfiguration(result.overrides)
  return {
    ...result,
    overrides: resolution.overrides,
    ...(resolution.warnings.length > 0 ? { conflictWarnings: resolution.warnings } : {}),
  }
}

function migrateLegacyHotkeyImport(result: HotkeyImportResult): HotkeyImportResult {
  const hasLegacyKeyframeBinding =
    result.overrides.EDIT_KEYFRAME_ADD === 'k' ||
    result.conflictWarnings?.some(
      (warning) => warning.command === 'EDIT_KEYFRAME_ADD' && warning.binding === 'k',
    )

  if ((result.sourceVersion === null || result.sourceVersion < 2) && hasLegacyKeyframeBinding) {
    const overrides = { ...result.overrides }
    delete overrides.EDIT_KEYFRAME_ADD
    const conflictWarnings = result.conflictWarnings?.filter(
      (warning) => warning.command !== 'EDIT_KEYFRAME_ADD',
    )
    const { conflictWarnings: _discardedWarnings, ...resultWithoutWarnings } = result
    return {
      ...resultWithoutWarnings,
      overrides,
      ...(conflictWarnings && conflictWarnings.length > 0 ? { conflictWarnings } : {}),
    }
  }

  return result
}

export function parseHotkeyImportDocument(source: unknown): HotkeyImportResult {
  if (!isRecord(source)) {
    throw new Error('Invalid hotkey preset format')
  }

  if (source.schema !== HOTKEY_EXPORT_SCHEMA) {
    return migrateLegacyHotkeyImport(resolveHotkeyImportResult(collectImportedOverrides(source)))
  }

  const sourceVersion = typeof source.version === 'number' ? source.version : null

  const overridesSource = isRecord(source.overrides) ? source.overrides : null
  const commandsSource = Array.isArray(source.commands) ? source.commands : []

  let importedCommandCount = 0
  let ignoredCommandCount = 0
  let remappedCommandCount = 0
  const importedOverrides: HotkeyOverrideMap = {}

  if (overridesSource) {
    const overrideImport = collectImportedOverrides(overridesSource)
    importedCommandCount += overrideImport.importedCommandCount
    ignoredCommandCount += overrideImport.ignoredCommandCount
    remappedCommandCount += overrideImport.remappedCommandCount
    Object.assign(importedOverrides, overrideImport.overrides)
  } else {
    for (const command of commandsSource) {
      if (!isRecord(command)) {
        ignoredCommandCount += 1
        continue
      }

      const importCommand = command as HotkeyImportCommand
      const rawBinding = getImportBinding(importCommand)
      const resolvedCommand = resolveHotkeyImportCommand(importCommand)

      if (!resolvedCommand.key || rawBinding === null) {
        ignoredCommandCount += 1
        continue
      }

      const normalizedBinding = normalizeHotkeyBinding(rawBinding)
      if (isExplicitlyUnassignedHotkey(rawBinding)) {
        importedCommandCount += 1
        if (resolvedCommand.wasRemapped) {
          remappedCommandCount += 1
        }
        importedOverrides[resolvedCommand.key] = ''
        continue
      }

      if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
        ignoredCommandCount += 1
        continue
      }

      importedCommandCount += 1
      if (resolvedCommand.wasRemapped) {
        remappedCommandCount += 1
      }

      if (normalizedBinding !== HOTKEYS[resolvedCommand.key]) {
        importedOverrides[resolvedCommand.key] = normalizedBinding
      }
    }
  }

  const resolution = resolveHotkeyConfiguration(importedOverrides)
  return migrateLegacyHotkeyImport({
    overrides: resolution.overrides,
    importedCommandCount,
    ignoredCommandCount,
    remappedCommandCount,
    sourceVersion,
    ...(resolution.warnings.length > 0 ? { conflictWarnings: resolution.warnings } : {}),
  })
}

const GLOBAL_HOTKEY_OPT_IN = '[data-global-hotkeys="allow"]'
const DIALOG_SELECTOR = '[role="dialog"], dialog'
const INTERACTIVE_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  'input',
  'textarea',
  'select',
  'option',
  'audio[controls]',
  'video[controls]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="treeitem"]',
  '[role="slider"]',
  '[role="scrollbar"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
].join(', ')

function isContentEditableTarget(target: Element): boolean {
  for (let current: Element | null = target; current; current = current.parentElement) {
    if (!current.hasAttribute('contenteditable')) continue
    const value = current.getAttribute('contenteditable')?.trim().toLowerCase() ?? ''
    if (value === 'false') return false
    if (value === '' || value === 'true' || value === 'plaintext-only') return true
  }
  return false
}

/**
 * Returns true when a global shortcut should be ignored for the focused DOM
 * target. Ignoring here is intentional: react-hotkeys-hook then leaves the
 * event alone, preserving dialog controls' default actions and propagation.
 */
export function shouldIgnoreGlobalHotkey(event: KeyboardEvent): boolean {
  const target = event.target
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  if (target.closest(GLOBAL_HOTKEY_OPT_IN)) return false
  if (isContentEditableTarget(target)) return true
  if (target.closest(INTERACTIVE_CONTROL_SELECTOR)) return true
  return target.closest(DIALOG_SELECTOR) !== null
}

/**
 * Options for react-hotkeys-hook.
 * Prevents shortcuts from firing in editable fields and dialog controls.
 */
export const HOTKEY_OPTIONS = {
  // Route normally excluded targets through ignoreEventWhen so the explicit
  // data-global-hotkeys="allow" escape hatch works for those targets too.
  enableOnFormTags: true,
  enableOnContentEditable: true,
  ignoreEventWhen: shouldIgnoreGlobalHotkey,
  preventDefault: true,
} as const
