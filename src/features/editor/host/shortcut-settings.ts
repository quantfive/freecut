import {
  resolveHotkeyConfiguration,
  type HotkeyConflictWarning,
  type HotkeyOverrideMap,
} from '@/config/hotkeys'
import { useSettingsStore } from '@/features/editor/deps/settings'
import {
  HOST_SHORTCUTS_SCHEMA,
  HOST_SHORTCUTS_VERSION,
  createHostShortcutSettings,
  type EditorHost,
  type HostShortcutSettings,
} from './contract'

function normalizeHostShortcutSettings(settings: HostShortcutSettings): {
  settings: HostShortcutSettings
  warnings: HotkeyConflictWarning[]
} {
  if (settings.schema !== HOST_SHORTCUTS_SCHEMA || settings.version !== HOST_SHORTCUTS_VERSION) {
    throw new Error('Unsupported host shortcut settings schema')
  }

  const resolution = resolveHotkeyConfiguration(settings.overrides)
  return {
    settings: createHostShortcutSettings(resolution.overrides),
    warnings: resolution.warnings,
  }
}

function copyOverrides(overrides: HotkeyOverrideMap): HotkeyOverrideMap {
  return { ...overrides }
}

interface ShortcutOwnership {
  epoch: number
  standaloneOverrides: HotkeyOverrideMap
}

let nextOwnershipEpoch = 0
let currentOwnership: ShortcutOwnership | null = null

/**
 * Hydrates host-owned shortcuts before the editor mounts, then keeps UI and
 * host/agent changes synchronized for the lifetime of the embedded surface.
 */
export async function mountHostShortcutSettings(host: EditorHost): Promise<() => void> {
  const port = host.shortcuts
  if (!port) {
    return () => undefined
  }

  const ownership: ShortcutOwnership = {
    epoch: ++nextOwnershipEpoch,
    standaloneOverrides: copyOverrides(
      currentOwnership?.standaloneOverrides ?? useSettingsStore.getState().hotkeyOverrides,
    ),
  }
  currentOwnership = ownership
  let applyingHostSettings = false
  let disposed = false
  let inboundRevision = 0
  let writeQueue = Promise.resolve()

  const isCurrent = () => !disposed && currentOwnership?.epoch === ownership.epoch

  const reportFailure = (message: string) => {
    host.notify?.({ kind: 'error', message })
  }

  const applyHostSettings = (settings: HostShortcutSettings) => {
    if (!isCurrent()) return
    const normalized = normalizeHostShortcutSettings(settings)
    inboundRevision += 1
    if (normalized.warnings.length > 0) {
      for (const warning of normalized.warnings) {
        host.notify?.({
          kind: 'conflict',
          message:
            warning.resolution === 'fallback'
              ? `Shortcut conflict for ${warning.command}; using its default binding.`
              : `Shortcut conflict for ${warning.command}; the binding was disabled.`,
        })
      }
    }
    applyingHostSettings = true
    try {
      useSettingsStore.getState().replaceHotkeyOverrides(normalized.settings.overrides)
    } finally {
      applyingHostSettings = false
    }
  }

  let initialSettings: HostShortcutSettings
  try {
    initialSettings = await Promise.resolve(port.getSettings())
  } catch (error) {
    if (currentOwnership?.epoch === ownership.epoch) currentOwnership = null
    throw error
  }
  if (!isCurrent()) {
    return () => undefined
  }
  applyHostSettings(initialSettings)

  const unsubscribeHost = port.subscribe?.((settings) => {
    if (!isCurrent()) return
    try {
      applyHostSettings(settings)
    } catch {
      reportFailure('Could not apply keyboard shortcuts from the host.')
    }
  })

  const unsubscribeStore = useSettingsStore.subscribe((state, previousState) => {
    if (
      disposed ||
      applyingHostSettings ||
      state.hotkeyOverrides === previousState.hotkeyOverrides
    ) {
      return
    }

    const settings = createHostShortcutSettings(copyOverrides(state.hotkeyOverrides))
    const revisionAtQueue = inboundRevision
    writeQueue = writeQueue
      .then(() => {
        if (!isCurrent() || inboundRevision !== revisionAtQueue) return undefined
        return Promise.resolve(port.setSettings(settings))
      })
      .catch(() => {
        reportFailure('Could not save keyboard shortcuts to the host.')
      })
  })

  return () => {
    disposed = true
    inboundRevision += 1
    unsubscribeStore()
    unsubscribeHost?.()
    if (currentOwnership?.epoch !== ownership.epoch) return
    currentOwnership = null
    useSettingsStore.getState().replaceHotkeyOverrides(ownership.standaloneOverrides)
  }
}
