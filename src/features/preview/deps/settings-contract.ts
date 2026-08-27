/**
 * Adapter exports for settings dependencies.
 * Preview modules should import settings stores through here.
 */

export { useSettingsStore } from '@/features/settings/stores/settings-store'
export {
  useResolvedHotkeys,
  useRuntimeHotkeys,
} from '@/features/settings/hooks/use-resolved-hotkeys'
