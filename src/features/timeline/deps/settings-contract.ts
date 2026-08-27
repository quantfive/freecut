/**
 * Adapter exports for settings dependencies.
 * Timeline modules should import settings stores from here.
 */

export { useSettingsStore } from '@/features/settings/stores/settings-store'
export {
  useResolvedHotkeys,
  useRuntimeHotkeys,
} from '@/features/settings/hooks/use-resolved-hotkeys'
