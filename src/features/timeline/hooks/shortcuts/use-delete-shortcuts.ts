/**
 * Delete shortcuts: Delete/Backspace - remove selected items, marker, or transition.
 *
 * Extracted from useEditingShortcuts so host-embedded surfaces can mount just
 * the remove bindings: item removal flows through the host bridge as
 * authoritative ripple_delete requests, while the remaining editing shortcuts (ripple delete,
 * nudges, join, freeze frame, keyframes) are unsupported in host mode.
 */

import { useCallback } from 'react'
import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineStore } from '../../stores/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts'
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store'
import { useEditorHostContext } from '../../deps/editor'

export function useDeleteShortcuts(callbacks: TimelineShortcutCallbacks) {
  const { mode: editorMode, host, timeline: hostTimeline } = useEditorHostContext()
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId)
  const editKeyframePanelOpen = useSelectionStore((s) => s.editKeyframePanelOpen)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes)
  const removeItems = useTimelineStore((s) => s.removeItems)
  const removeMarker = useTimelineStore((s) => s.removeMarker)
  const removeTransition = useTimelineStore((s) => s.removeTransition)
  const keyframeEditorShortcutScopeActive = useEditorStore(
    (s) => s.keyframeEditorShortcutScopeActive,
  )
  const transcriptEditorShortcutScopeActive = useEditorStore(
    (s) => s.transcriptEditorShortcutScopeActive,
  )
  // Another panel (keyframe or transcript editor) owns Delete/Backspace — clip
  // delete must yield so it doesn't also fire and remove the timeline clip.
  const deleteOwnedByPanel =
    keyframeEditorShortcutScopeActive ||
    (editKeyframePanelOpen && selectedKeyframes.length > 0) ||
    transcriptEditorShortcutScopeActive

  const deleteSelection = useCallback(
    (event: KeyboardEvent) => {
      if (deleteOwnedByPanel) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (selectedTransitionId) {
        event.preventDefault()
        removeTransition(selectedTransitionId)
        clearSelection()
        return
      }
      if (selectedMarkerId) {
        event.preventDefault()
        removeMarker(selectedMarkerId)
        clearSelection()
        return
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault()
        if (editorMode === 'host') {
          if (hostTimeline) void hostTimeline.requestRippleDelete(selectedItemIds)
          else host?.notify?.({ kind: 'unsupported', message: 'Timeline delete is unavailable' })
          return
        }
        removeItems(selectedItemIds)
        if (callbacks.onDelete) {
          callbacks.onDelete()
        }
      }
    },
    [
      deleteOwnedByPanel,
      selectedItemIds,
      selectedMarkerId,
      selectedTransitionId,
      removeItems,
      removeMarker,
      removeTransition,
      clearSelection,
      callbacks,
      editorMode,
      hostTimeline,
      host,
    ],
  )

  // Editing: Delete - Delete selected items, marker, or transition
  useCommandHotkey('DELETE_SELECTED', deleteSelection, HOTKEY_OPTIONS, [deleteSelection])

  // Editing: Backspace - Delete selected items, marker, or transition (alternative)
  useCommandHotkey('DELETE_SELECTED_ALT', deleteSelection, HOTKEY_OPTIONS, [deleteSelection])
}
