import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'

import { useSceneBrowserStore } from '@/features/editor/deps/scene-browser'

interface EditorHotkeyCallbacks {
  onSave?: () => void
  onExport?: () => void
  enableLocalUi?: boolean
}

/**
 * Global editor keyboard shortcuts
 *
 * Handles editor-level shortcuts that work across all components:
 * - Save (Ctrl+S) - Saves timeline to project
 * - Export (Ctrl+Shift+E) - Exports video
 * - Open Scene Browser (Ctrl+Shift+F) - Opens caption search across media
 *
 * Note: Undo/Redo are handled in useTimelineShortcuts since they're timeline-specific
 *
 * Uses react-hotkeys-hook with granular Zustand selectors
 */
export function useEditorHotkeys(callbacks: EditorHotkeyCallbacks = {}) {
  const enableLocalUi = callbacks.enableLocalUi ?? true

  // Save: Cmd/Ctrl+S
  useCommandHotkey(
    'SAVE',
    (event) => {
      event.preventDefault()
      if (callbacks.onSave) {
        callbacks.onSave()
      }
    },
    HOTKEY_OPTIONS,
    [callbacks.onSave],
  )

  // Export: Cmd/Ctrl+Shift+E
  useCommandHotkey(
    'EXPORT',
    (event) => {
      event.preventDefault()
      if (callbacks.onExport) {
        callbacks.onExport()
      }
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [callbacks.onExport],
  )

  // Open Scene Browser: Cmd/Ctrl+Shift+F — capture phase because the
  // default browser binding is a no-op here but Chrome will still eat it
  // if our listener is in bubbling phase.
  useCommandHotkey(
    'OPEN_SCENE_BROWSER',
    (event) => {
      if (!enableLocalUi) return
      event.preventDefault()
      useSceneBrowserStore.getState().openBrowser({ focus: true })
    },
    { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } },
    [enableLocalUi],
  )

  // Workspace switching: Alt+1 (Edit), Alt+2 (Color), Alt+3 (Motion).
  // WORKSPACE_ANIMATE retains its persisted command id for shortcut migration.
  useCommandHotkey(
    'WORKSPACE_EDIT',
    (event) => {
      if (!enableLocalUi) return
      event.preventDefault()
      useEditorStore.getState().setWorkspace('edit')
    },
    HOTKEY_OPTIONS,
    [enableLocalUi],
  )

  useCommandHotkey(
    'WORKSPACE_COLOR',
    (event) => {
      if (!enableLocalUi) return
      event.preventDefault()
      useEditorStore.getState().setWorkspace('color')
    },
    HOTKEY_OPTIONS,
    [enableLocalUi],
  )

  useCommandHotkey(
    'WORKSPACE_ANIMATE',
    (event) => {
      if (!enableLocalUi) return
      event.preventDefault()
      useEditorStore.getState().setWorkspace('motion')
    },
    HOTKEY_OPTIONS,
    [enableLocalUi],
  )
}
