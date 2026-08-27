/**
 * Source Monitor shortcuts (global):
 *   , (Insert Edit), . (Overwrite Edit)
 *
 * These work globally as long as the source monitor is open.
 *
 * Mark In/Out/Clear (I, O, Alt+X) are handled locally inside the
 * SourceMonitor component via onKeyDown so they only fire when the
 * source monitor is hovered/focused.
 */

import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'
import { performInsertEdit, performOverwriteEdit } from '../../stores/actions/source-edit-actions'

export function useSourceMonitorShortcuts() {
  // Insert Edit: , (comma) — works globally when source monitor is open
  useCommandHotkey(
    'INSERT_EDIT',
    (event) => {
      event.preventDefault()
      const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId
      if (!sourceMediaId) return
      performInsertEdit()
    },
    HOTKEY_OPTIONS,
    [],
  )

  // Overwrite Edit: . (period) — works globally when source monitor is open
  useCommandHotkey(
    'OVERWRITE_EDIT',
    (event) => {
      event.preventDefault()
      const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId
      if (!sourceMediaId) return
      performOverwriteEdit()
    },
    HOTKEY_OPTIONS,
    [],
  )
}
