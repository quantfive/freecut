/**
 * Timeline in/out shortcuts: I, O, Shift+I/O, Alt+X.
 */

import {
  COMMAND_HOTKEYS as hotkeys,
  useCommandHotkey,
  useDerivedCommandHotkey,
} from '@/hooks/use-hotkey-registration'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '../../stores/timeline-store'

export function useInOutShortcuts() {
  useCommandHotkey(
    hotkeys.MARK_IN,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useDerivedCommandHotkey(
    'MARK_IN',
    'preview',
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useCommandHotkey(
    hotkeys.MARK_OUT,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useDerivedCommandHotkey(
    'MARK_OUT',
    'preview',
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useCommandHotkey(
    hotkeys.CLEAR_IN_OUT,
    (event) => {
      event.preventDefault()
      useTimelineStore.getState().clearInOutPoints()
    },
    HOTKEY_OPTIONS,
    [],
  )
}
