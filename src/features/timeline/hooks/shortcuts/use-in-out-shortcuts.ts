/**
 * Timeline in/out shortcuts: I, O, Shift+I/O, Alt+X.
 */

import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS, getRuntimeHotkeyBinding } from '@/config/hotkeys'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '../../stores/timeline-store'
import { useResolvedHotkeys, useRuntimeHotkeys } from '@/features/timeline/deps/settings'

export function useInOutShortcuts() {
  const resolvedHotkeys = useResolvedHotkeys()
  const hotkeys = useRuntimeHotkeys()
  const markInAtPreview = getRuntimeHotkeyBinding(resolvedHotkeys, 'MARK_IN', 'preview')
  const markOutAtPreview = getRuntimeHotkeyBinding(resolvedHotkeys, 'MARK_OUT', 'preview')

  useHotkeys(
    hotkeys.MARK_IN,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markInAtPreview ?? [],
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setInPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markInAtPreview],
  )

  useHotkeys(
    hotkeys.MARK_OUT,
    (event) => {
      event.preventDefault()
      const { currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(currentFrame)
    },
    HOTKEY_OPTIONS,
    [],
  )

  useHotkeys(
    markOutAtPreview ?? [],
    (event) => {
      event.preventDefault()
      const { previewFrame, currentFrame } = usePlaybackStore.getState()
      useTimelineStore.getState().setOutPoint(previewFrame ?? currentFrame)
    },
    HOTKEY_OPTIONS,
    [markOutAtPreview],
  )

  useHotkeys(
    hotkeys.CLEAR_IN_OUT,
    (event) => {
      event.preventDefault()
      useTimelineStore.getState().clearInOutPoints()
    },
    HOTKEY_OPTIONS,
    [],
  )
}
