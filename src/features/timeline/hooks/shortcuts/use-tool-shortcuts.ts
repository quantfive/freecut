/**
 * Tool shortcuts: V (Select), T (Trim Edit), Shift+C (Razor), C (hover split), R (Rate Stretch).
 */

import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useSelectionStore } from '@/shared/state/selection'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts'
import { SLIP_SLIDE_TOOLS_ENABLED } from '../../constants'
import { getTimelineHover } from '../../utils/timeline-hover-state'
import { notifySplitRejection } from '../../stores/actions/item-actions'
import { isMicRecordingActive, useMicRecordingStore } from '@/shared/state/mic-recording-store'

function splitHoveredTimelineItemAtPointer(): boolean {
  if (isMicRecordingActive(useMicRecordingStore.getState().status)) {
    notifySplitRejection('recording')
    return false
  }

  const { itemId, frame } = getTimelineHover()
  const { items } = useTimelineStore.getState()

  if (!itemId || frame === null) {
    notifySplitRejection('no-hover')
    return false
  }

  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) {
    notifySplitRejection('no-hover')
    return false
  }

  if (frame <= item.from || frame >= item.from + item.durationInFrames) {
    notifySplitRejection('out-of-range')
    return false
  }

  const itemCountBeforeSplit = items.length
  const undoDepthBeforeSplit = useTimelineCommandStore.getState().undoStack.length
  useTimelineStore.getState().splitItem(item.id, frame)
  return (
    useTimelineStore.getState().items.length > itemCountBeforeSplit &&
    useTimelineCommandStore.getState().undoStack.length > undoDepthBeforeSplit
  )
}

export function useToolShortcuts(callbacks: TimelineShortcutCallbacks) {
  const activeTool = useSelectionStore((s) => s.activeTool)
  const setActiveTool = useSelectionStore((s) => s.setActiveTool)

  // Tool: V - Selection Tool
  useCommandHotkey(
    'SELECTION_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool('select')
    },
    HOTKEY_OPTIONS,
    [setActiveTool],
  )

  // Tool: T - Toggle Trim Edit Tool
  useCommandHotkey(
    'TRIM_EDIT_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool(activeTool === 'trim-edit' ? 'select' : 'trim-edit')
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool],
  )

  // Tool: Shift+C - Toggle persistent Razor/Cut Mode
  useCommandHotkey(
    'RAZOR_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool(activeTool === 'razor' ? 'select' : 'razor')
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool],
  )

  // Editing: C - Split the clip currently under the pointer at its exact hover frame.
  // This intentionally does not fall back to currentFrame or the throttled
  // playback preview: a stale preview must never become an edit location.
  useCommandHotkey(
    'SPLIT_AT_PLAYHEAD',
    (event) => {
      event.preventDefault()
      if (splitHoveredTimelineItemAtPointer() && callbacks.onSplit) {
        callbacks.onSplit()
      }
    },
    HOTKEY_OPTIONS,
    [callbacks],
  )

  // Tool: R - Toggle Rate Stretch Tool
  useCommandHotkey(
    'RATE_STRETCH_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch')
    },
    HOTKEY_OPTIONS,
    [activeTool, setActiveTool],
  )

  // Tool: Y - Toggle Slip Tool
  useCommandHotkey(
    'SLIP_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool(activeTool === 'slip' ? 'select' : 'slip')
    },
    { ...HOTKEY_OPTIONS, enabled: SLIP_SLIDE_TOOLS_ENABLED },
    [activeTool, setActiveTool],
  )

  // Tool: U - Toggle Slide Tool
  useCommandHotkey(
    'SLIDE_TOOL',
    (event) => {
      event.preventDefault()
      setActiveTool(activeTool === 'slide' ? 'select' : 'slide')
    },
    { ...HOTKEY_OPTIONS, enabled: SLIP_SLIDE_TOOLS_ENABLED },
    [activeTool, setActiveTool],
  )
}
