import { useShallow } from 'zustand/react/shallow'
import { resolveHotkeys, resolveRuntimeHotkeys } from '@/config/hotkeys'
import { useSettingsStore } from '../stores/settings-store'

export function useResolvedHotkeys() {
  return useSettingsStore(useShallow((state) => resolveHotkeys(state.hotkeyOverrides)))
}

/** Runtime registrations only; display and persistence must use useResolvedHotkeys. */
export function useRuntimeHotkeys() {
  return useSettingsStore(
    useShallow((state) => resolveRuntimeHotkeys(resolveHotkeys(state.hotkeyOverrides))),
  )
}
