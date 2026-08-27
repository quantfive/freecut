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
  dispose?: () => void
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
  const previousOwnership = currentOwnership
  const standaloneOverrides = copyOverrides(
    previousOwnership?.standaloneOverrides ?? useSettingsStore.getState().hotkeyOverrides,
  )
  previousOwnership?.dispose?.()
  const ownership: ShortcutOwnership = {
    epoch: ++nextOwnershipEpoch,
    standaloneOverrides,
  }
  currentOwnership = ownership
  let applyingHostSettings = false
  let disposed = false
  let unsubscribeHost: (() => void) | undefined
  let unsubscribeStore: (() => void) | undefined

  const isCurrent = () => !disposed && currentOwnership?.epoch === ownership.epoch

  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeStore?.()
    unsubscribeHost?.()
    signal?.removeEventListener('abort', dispose)
    if (currentOwnership?.epoch !== ownership.epoch) return
    currentOwnership = null
    useSettingsStore.getState().replaceHotkeyOverrides(ownership.standaloneOverrides)
  }
  ownership.dispose = dispose

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

  const settingsEqual = (left: HostShortcutSettings, right: HostShortcutSettings) => {
    const leftKeys = Object.keys(left.overrides)
    const rightKeys = Object.keys(right.overrides)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          left.overrides[key as keyof HotkeyOverrideMap] ===
          right.overrides[key as keyof HotkeyOverrideMap],
      )
    )
  }

  let desiredSettings: HostShortcutSettings | null = null
  let settledSettings: HostShortcutSettings | null = null
  let inFlightSettings: HostShortcutSettings | null = null
  let reconcileAfterFlight = false
  let reconcileScheduled = false

  const canStartReconcile = () => {
    if (!isCurrent()) return false
    if (inFlightSettings || !desiredSettings) return false
    if (reconcileAfterFlight || !settledSettings) return true
    return !settingsEqual(desiredSettings, settledSettings)
  }

  const finishReconcile = (settingsToWrite: HostShortcutSettings, succeeded: boolean) => {
    if (!isCurrent()) return
    if (succeeded) settledSettings = settingsToWrite
    const desiredChanged =
      desiredSettings !== null && !settingsEqual(desiredSettings, settingsToWrite)
    inFlightSettings = null
    if (desiredChanged || reconcileAfterFlight) scheduleReconcile()
  }

  const persistDesiredSettings = async () => {
    reconcileScheduled = false
    if (!canStartReconcile()) return

    const settingsToWrite = desiredSettings!
    inFlightSettings = settingsToWrite
    reconcileAfterFlight = false
    let succeeded = false
    try {
      await Promise.resolve(port.setSettings(settingsToWrite))
      succeeded = true
    } catch {
      if (isCurrent()) reportFailure('Could not save keyboard shortcuts to the host.')
    }
    finishReconcile(settingsToWrite, succeeded)
  }

  function scheduleReconcile() {
    if (reconcileScheduled || inFlightSettings || !desiredSettings) return
    reconcileScheduled = true
    void Promise.resolve().then(persistDesiredSettings)
  }

  const applyHostSettings = (settings: HostShortcutSettings) => {
    if (!isCurrent()) return
    const normalized = normalizeHostShortcutSettings(settings)
    if (normalized.warnings.length > 0) {
      for (const warning of normalized.warnings) {
        host.notify?.({
          kind: 'conflict',
          message: `Shortcut ${warning.binding} for ${warning.command} conflicts with ${warning.conflictingCommand}; retained the last valid shortcut settings.`,
        })
      }
      return
    }
    applyingHostSettings = true
    try {
      useSettingsStore.getState().replaceHotkeyOverrides(normalized.settings.overrides)
    } finally {
      applyingHostSettings = false
    }
    desiredSettings = normalized.settings
    if (inFlightSettings) {
      reconcileAfterFlight = !settingsEqual(inFlightSettings, normalized.settings)
    } else {
      // A subscription is the host's persisted authority unless an older write
      // can still complete after it and overwrite that state.
      settledSettings = normalized.settings
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
  desiredSettings = createHostShortcutSettings(
    copyOverrides(useSettingsStore.getState().hotkeyOverrides),
  )
  settledSettings = initialSettings
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
    desiredSettings = settings
    scheduleReconcile()
  })

  return dispose
}
