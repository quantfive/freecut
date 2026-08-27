import {
  getRuntimeHotkeyBinding,
  resolveHotkeys,
  resolveRuntimeHotkeys,
  type HotkeyBindingMap,
  type HotkeyKey,
  type HotkeyOverrideMap,
} from '@/config/hotkeys'
import { useSettingsStore } from '@/features/settings/stores/settings-store'

interface RuntimeHotkeySnapshot {
  primary: HotkeyBindingMap
  preview: Record<'MARK_IN' | 'MARK_OUT', string>
}

let cachedOverrides: HotkeyOverrideMap | null = null
let cachedRuntimeSnapshot: RuntimeHotkeySnapshot | null = null

function getRuntimeHotkeySnapshot(overrides: HotkeyOverrideMap): RuntimeHotkeySnapshot {
  if (cachedOverrides === overrides && cachedRuntimeSnapshot) return cachedRuntimeSnapshot

  const resolved = resolveHotkeys(overrides)
  cachedOverrides = overrides
  cachedRuntimeSnapshot = {
    primary: resolveRuntimeHotkeys(resolved),
    preview: {
      MARK_IN: getRuntimeHotkeyBinding(resolved, 'MARK_IN', 'preview') ?? '',
      MARK_OUT: getRuntimeHotkeyBinding(resolved, 'MARK_OUT', 'preview') ?? '',
    },
  }
  return cachedRuntimeSnapshot
}

/** Runtime-only selector; display and persistence must use resolved maps instead. */
export function useRuntimeHotkeyBinding(
  command: HotkeyKey,
  variant: 'primary' | 'preview' = 'primary',
): string {
  return useSettingsStore((state) => {
    const snapshot = getRuntimeHotkeySnapshot(state.hotkeyOverrides)
    if (variant === 'preview' && (command === 'MARK_IN' || command === 'MARK_OUT')) {
      return snapshot.preview[command]
    }
    return snapshot.primary[command]
  })
}
