import type { DependencyList } from 'react'
import { useHotkeys, type HotkeyCallback, type Options } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS, type HotkeyKey } from '@/config/hotkeys'
import { useRuntimeHotkeyBinding } from './use-runtime-hotkey-binding'

type HotkeyOptionsOrDependencies = Options | DependencyList
export type DerivedHotkeyCommand = 'MARK_IN' | 'MARK_OUT'

const LOCAL_HOTKEY_BINDINGS = {
  DOPESHEET_DELETE: 'delete,backspace',
  DOPESHEET_NUDGE_LEFT: 'left',
  DOPESHEET_NUDGE_RIGHT: 'right',
  DOPESHEET_NUDGE_LEFT_LARGE: 'shift+left',
  DOPESHEET_NUDGE_RIGHT_LARGE: 'shift+right',
} as const

export type LocalHotkeyKey = keyof typeof LOCAL_HOTKEY_BINDINGS

/** Runtime-only command binding. Display and persistence must use resolved maps instead. */
export function useCommandHotkeyBinding(command: HotkeyKey): string {
  return useRuntimeHotkeyBinding(command)
}

function useDerivedCommandHotkeyBinding(command: DerivedHotkeyCommand): string {
  return useRuntimeHotkeyBinding(command, 'preview')
}

/** The sole production registration path for primary command hotkeys. */
export function useCommandHotkey<T extends HTMLElement>(
  command: HotkeyKey,
  callback: HotkeyCallback,
  options: HotkeyOptionsOrDependencies = HOTKEY_OPTIONS,
  dependencies?: HotkeyOptionsOrDependencies,
) {
  const binding = useCommandHotkeyBinding(command)
  return useHotkeys<T>(binding, callback, options, dependencies)
}

/** Typed registration path for centrally owned modifier-derived command variants. */
export function useDerivedCommandHotkey<T extends HTMLElement>(
  command: DerivedHotkeyCommand,
  _variant: 'preview',
  callback: HotkeyCallback,
  options: HotkeyOptionsOrDependencies = HOTKEY_OPTIONS,
  dependencies?: HotkeyOptionsOrDependencies,
) {
  const binding = useDerivedCommandHotkeyBinding(command)
  return useHotkeys<T>(binding, callback, options, dependencies)
}

/**
 * Low-level, non-command bindings local to the dopesheet. Callers choose a
 * closed local key, so command maps and HotkeyKey-derived strings cannot enter
 * this API.
 */
export function useLocalHotkey<T extends HTMLElement>(
  localKey: LocalHotkeyKey,
  callback: HotkeyCallback,
  options?: HotkeyOptionsOrDependencies,
  dependencies?: HotkeyOptionsOrDependencies,
) {
  return useHotkeys<T>(LOCAL_HOTKEY_BINDINGS[localKey], callback, options, dependencies)
}
