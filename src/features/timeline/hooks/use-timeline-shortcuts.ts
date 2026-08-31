import { usePlaybackShortcuts } from './shortcuts/use-playback-shortcuts'
import { useEditingShortcuts } from './shortcuts/use-editing-shortcuts'
import { useDeleteShortcuts } from './shortcuts/use-delete-shortcuts'
import { useToolShortcuts } from './shortcuts/use-tool-shortcuts'
import { useMarkerShortcuts } from './shortcuts/use-marker-shortcuts'
import { useInOutShortcuts } from './shortcuts/use-in-out-shortcuts'
import { useUIShortcuts } from './shortcuts/use-ui-shortcuts'
import { useClipboardShortcuts } from './shortcuts/use-clipboard-shortcuts'
import { useSourceMonitorShortcuts } from './shortcuts/use-source-monitor-shortcuts'

export interface TimelineShortcutCallbacks {
  onPlay?: () => void
  onPause?: () => void
  onSplit?: () => void
  onDelete?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onZoomToFit?: () => void
}

/**
 * Timeline keyboard shortcuts hook
 *
 * Composes domain-specific shortcut hooks for:
 * - Playback & navigation (Space, arrows, Home/End, snap points)
 * - Editing (Delete, split, join, keyframes)
 * - Tools (V/T/Shift+C/R tool switching, C hover split)
 * - Markers (M add/remove, [ ] navigate)
 * - In/Out markers (I, O, Shift+I/O, Alt+X)
 * - UI (S snap, Z zoom, undo/redo)
 * - Clipboard (Ctrl+C/X/V)
 *
 * Note: Zoom is handled via Ctrl+Scroll only (see TimelineContent component)
 */
export function useTimelineShortcuts(callbacks: TimelineShortcutCallbacks = {}) {
  usePlaybackShortcuts(callbacks)
  useEditingShortcuts(callbacks)
  useToolShortcuts(callbacks)
  useMarkerShortcuts()
  useInOutShortcuts()
  useUIShortcuts(callbacks)
  useClipboardShortcuts()
  useSourceMonitorShortcuts()
}

/**
 * Host-embedded timeline keyboard shortcuts.
 *
 * Composes only the bindings that are safe while a host owns the
 * authoritative timeline document:
 * - Playback & navigation (Space, J/K/L, arrows, Home/End, snap points) —
 *   local playback state that never crosses the host bridge.
 * - Tools (V/T/Shift+C/R tool switching, C hover split) — tool switching is
 *   pure local UI; split flows through the bridge as a supported split_item command.
 * - Delete/Backspace — produces one authoritative ripple_delete request.
 * - UI zoom/snap (S, Shift+S, Cmd/Ctrl+=/-, \, Shift+\) — local view state.
 *
 * Deliberately excluded: undo/redo (mutate the temporal store without host
 * commands), modifier ripple delete, clipboard, markers, in/out points, nudges, join,
 * freeze frame, and clear-keyframes — all unsupported by the host slice.
 */
export function useHostTimelineShortcuts(callbacks: TimelineShortcutCallbacks = {}) {
  usePlaybackShortcuts(callbacks)
  useDeleteShortcuts(callbacks)
  useToolShortcuts(callbacks)
  useUIShortcuts(callbacks, { enableHistory: false })
}
