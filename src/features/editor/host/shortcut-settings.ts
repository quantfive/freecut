import { sanitizeHotkeyOverrides, type HotkeyOverrideMap } from '@/config/hotkeys'
import { useSettingsStore } from '@/features/editor/deps/settings'
import {
  HOST_SHORTCUTS_SCHEMA,
  HOST_SHORTCUTS_VERSION,
  createHostShortcutSettings,
  type EditorHost,
  type HostShortcutSettings,
} from './contract'

function normalizeHostShortcutSettings(settings: HostShortcutSettings): HostShortcutSettings {
  if (settings.schema !== HOST_SHORTCUTS_SCHEMA || settings.version !== HOST_SHORTCUTS_VERSION) {
    throw new Error('Unsupported host shortcut settings schema')
  }

  return createHostShortcutSettings(sanitizeHotkeyOverrides(settings.overrides))
}

function copyOverrides(overrides: HotkeyOverrideMap): HotkeyOverrideMap {
  return { ...overrides }
}

/**
 * Hydrates host-owned shortcuts before the editor mounts, then keeps UI and
 * host/agent changes synchronized for the lifetime of the embedded surface.
 */
export async function mountHostShortcutSettings(host: EditorHost): Promise<() => void> {
  const port = host.shortcuts
  if (!port) {
    return () => undefined
  }

  const standaloneOverrides = copyOverrides(useSettingsStore.getState().hotkeyOverrides)
  let applyingHostSettings = false
  let disposed = false
  let writeQueue = Promise.resolve()

  const reportFailure = (message: string) => {
    host.notify?.({ kind: 'error', message })
  }

  const applyHostSettings = (settings: HostShortcutSettings) => {
    if (disposed) return
    const normalized = normalizeHostShortcutSettings(settings)
    applyingHostSettings = true
    try {
      useSettingsStore.getState().replaceHotkeyOverrides(normalized.overrides)
    } finally {
      applyingHostSettings = false
    }
  }

  applyHostSettings(await Promise.resolve(port.getSettings()))

  const unsubscribeHost = port.subscribe?.((settings) => {
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
    writeQueue = writeQueue
      .then(() => Promise.resolve(port.setSettings(settings)))
      .catch(() => {
        reportFailure('Could not save keyboard shortcuts to the host.')
      })
  })

  return () => {
    disposed = true
    unsubscribeStore()
    unsubscribeHost?.()
    useSettingsStore.getState().replaceHotkeyOverrides(standaloneOverrides)
  }
}
