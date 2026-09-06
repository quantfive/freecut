/**
 * UI shortcuts: S (snap toggle), Cmd/Ctrl+=/- (zoom), \\ (zoom to fit), Shift+\\ or Cmd/Ctrl+0 (zoom to 100%), Undo/Redo.
 */

import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { useTimelineStore } from '../../stores/timeline-store'
import { useZoomStore, getZoomTo100Handler } from '../../stores/zoom-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import type { TimelineShortcutCallbacks } from '../use-timeline-shortcuts'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useEditorHostContext } from '../../deps/editor'

function invokeHostHistoryAction(
  action: () => Promise<void> | void,
  notify: ((notice: { kind: 'error'; message: string }) => void) | undefined,
  label: 'undo' | 'redo',
): void {
  const reportFailure = () => {
    try {
      notify?.({ kind: 'error', message: `Host ${label} failed` })
    } catch {
      // A notification failure must not turn a rejected host action into an
      // unhandled rejection.
    }
  }

  try {
    void Promise.resolve(action()).catch(reportFailure)
  } catch {
    reportFailure()
  }
}

export interface UIShortcutOptions {
  /**
   * Enables local temporal-store undo/redo. Host mode uses its optional
   * history port instead, and disables these shortcuts when that port is absent.
   */
  enableHistory?: boolean
}

export function useUIShortcuts(
  callbacks: TimelineShortcutCallbacks,
  options: UIShortcutOptions = {},
) {
  const { enableHistory = true } = options
  const { mode: editorMode, host } = useEditorHostContext()
  const hostHistory = editorMode === 'host' ? host?.history : undefined
  const historyEnabled = editorMode === 'host' ? hostHistory !== undefined : enableHistory
  const toggleSnap = useTimelineStore((s) => s.toggleSnap)
  const zoomIn = useZoomStore((s) => s.zoomIn)
  const zoomOut = useZoomStore((s) => s.zoomOut)

  // History: Cmd/Ctrl+Z - Undo
  useCommandHotkey(
    'UNDO',
    (event) => {
      event.preventDefault()
      if (hostHistory) {
        invokeHostHistoryAction(
          () => hostHistory.undo(),
          (notice) => host?.notify?.(notice),
          'undo',
        )
      } else if (historyEnabled) {
        useTimelineStore.temporal.getState().undo()
      }
      if (callbacks.onUndo) {
        callbacks.onUndo()
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true,
      enabled: historyEnabled,
    },
    [callbacks, historyEnabled, host, hostHistory],
  )

  // History: Cmd/Ctrl+Shift+Z - Redo
  useCommandHotkey(
    'REDO',
    (event) => {
      event.preventDefault()
      if (hostHistory) {
        invokeHostHistoryAction(
          () => hostHistory.redo(),
          (notice) => host?.notify?.(notice),
          'redo',
        )
      } else if (historyEnabled) {
        useTimelineStore.temporal.getState().redo()
      }
      if (callbacks.onRedo) {
        callbacks.onRedo()
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enableOnFormTags: true,
      enabled: historyEnabled,
    },
    [callbacks, historyEnabled, host, hostHistory],
  )

  // UI: S - Toggle Snap
  useCommandHotkey(
    'TOGGLE_SNAP',
    (event) => {
      event.preventDefault()
      toggleSnap()
    },
    HOTKEY_OPTIONS,
    [toggleSnap],
  )

  // UI: Shift+S - Toggle Canvas (gizmo) Snap — independent from timeline snap.
  useCommandHotkey(
    'TOGGLE_CANVAS_SNAP',
    (event) => {
      event.preventDefault()
      const s = useSettingsStore.getState()
      s.setSetting('canvasSnapEnabled', !s.canvasSnapEnabled)
    },
    HOTKEY_OPTIONS,
    [],
  )

  const zoomHotkeyOptions = { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } }

  // Zoom: Cmd/Ctrl+Equals - Zoom in
  useCommandHotkey(
    'ZOOM_IN',
    (event) => {
      event.preventDefault()
      zoomIn()
    },
    zoomHotkeyOptions,
    [zoomIn],
  )

  // Zoom: Cmd/Ctrl+Minus - Zoom out
  useCommandHotkey(
    'ZOOM_OUT',
    (event) => {
      event.preventDefault()
      zoomOut()
    },
    zoomHotkeyOptions,
    [zoomOut],
  )

  // Zoom: Backslash - Zoom to Fit
  useCommandHotkey(
    'ZOOM_TO_FIT',
    (event) => {
      event.preventDefault()
      if (callbacks.onZoomToFit) {
        callbacks.onZoomToFit()
        return
      }
      const container = document.querySelector('.timeline-container')
      if (!container) return

      const fps = useTimelineStore.getState().fps
      const items = useTimelineStore.getState().items
      const containerWidth = container.clientWidth

      const contentDuration = Math.max(
        10,
        items.reduce((max, item) => {
          const itemEnd = (item.from + item.durationInFrames) / fps
          return Math.max(max, itemEnd)
        }, 0),
      )

      useZoomStore.getState().zoomToFit(containerWidth, contentDuration)

      ;(container as HTMLElement).scrollLeft = 0
    },
    HOTKEY_OPTIONS,
    [callbacks],
  )

  // Zoom: Shift+Backslash - Zoom to 100% centered on cursor (or playhead if cursor not on timeline)
  useCommandHotkey(
    'ZOOM_TO_100',
    (event) => {
      event.preventDefault()
      const { currentFrame, previewFrame } = usePlaybackStore.getState()
      const targetFrame = previewFrame ?? currentFrame

      const handler = getZoomTo100Handler()
      if (handler) {
        handler(targetFrame)
      }
    },
    HOTKEY_OPTIONS,
    [],
  )

  // Zoom: Cmd/Ctrl+0 - Reset timeline zoom to 100%
  useCommandHotkey(
    'ZOOM_TO_100_ALT',
    (event) => {
      event.preventDefault()
      const { currentFrame, previewFrame } = usePlaybackStore.getState()
      const targetFrame = previewFrame ?? currentFrame

      const handler = getZoomTo100Handler()
      if (handler) {
        handler(targetFrame)
      }
    },
    zoomHotkeyOptions,
    [],
  )
}
