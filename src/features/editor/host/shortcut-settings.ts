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
export async function mountHostShortcutSettings(
  host: EditorHost,
  signal?: AbortSignal,
): Promise<() => void> {
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
  let unsubscribeHost: (() => void) | undefined
  let unsubscribeStore: (() => void) | undefined

  const isCurrent = () => !disposed && currentOwnership?.epoch === ownership.epoch

  const dispose = () => {
    if (disposed) return
    disposed = true
    inboundRevision += 1
    unsubscribeStore?.()
    unsubscribeHost?.()
    signal?.removeEventListener('abort', dispose)
    if (currentOwnership?.epoch !== ownership.epoch) return
    currentOwnership = null
    useSettingsStore.getState().replaceHotkeyOverrides(ownership.standaloneOverrides)
  }

  if (signal?.aborted) {
    dispose()
    return dispose
  }
  signal?.addEventListener('abort', dispose, { once: true })

  // Replacing a host invalidates the previous epoch immediately, including
  // while either host is still resolving getSettings. Keep the standalone
  // snapshot visible until this owner has authoritative settings to apply.
  useSettingsStore.getState().replaceHotkeyOverrides(ownership.standaloneOverrides)

  const port = host.shortcuts
  if (!port) {
    return dispose
  }

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
    dispose()
    throw error
  }
  if (!isCurrent()) {
    return dispose
  }
  applyHostSettings(initialSettings)

  unsubscribeHost = port.subscribe?.((settings) => {
    if (!isCurrent()) return
    try {
      applyHostSettings(settings)
    } catch {
      reportFailure('Could not apply keyboard shortcuts from the host.')
    }
  })

  unsubscribeStore = useSettingsStore.subscribe((state, previousState) => {
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
        if (isCurrent()) reportFailure('Could not save keyboard shortcuts to the host.')
      })
  })

  return dispose
}
