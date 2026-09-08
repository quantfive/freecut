import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings2, X } from 'lucide-react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { MediaSidebar } from './media-sidebar'
import { AudioMeterPanel } from './audio-meter-panel'
import { PropertiesSidebar } from './properties-sidebar'

/** Host-owned actions stay outside the independently hidden columns. */
export interface EditorShellOptions {
  onLayoutChange?: (layout: {
    minimumWidth: number
    libraryVisible: boolean
    editorVisible: boolean
  }) => void
  headerActions?: ReactNode
  navigationActions?: ReactNode
  transcriptActions?: ReactNode
}

export function EditorWorkspaceShell({
  children,
  options,
}: {
  children: ReactNode
  options?: EditorShellOptions
}) {
  const { t } = useTranslation()
  const [availableWidth, setAvailableWidth] = useState(280)
  const [settingsNotice, setSettingsNotice] = useState(false)
  const settingsSelection = useRef<string[]>([])
  const [libraryVisible, setLibraryVisible] = useState(true)
  const [editorVisible, setEditorVisible] = useState(true)
  const [libraryWidth, setLibraryWidth] = useState(280)
  const [metersOpen, setMetersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const libraryToggleRef = useRef<HTMLButtonElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const settingsPanel = useRef<HTMLElement>(null)
  const selectedIds = useSelectionStore((s) => s.selectedItemIds)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (settingsOpen && settingsSelection.current.some((id) => !selectedIds.includes(id))) {
      setSettingsOpen(false)
      setSettingsNotice(true)
      if (settingsPanel.current?.contains(document.activeElement)) {
        settingsTrigger.current?.focus()
      }
    }
  }, [selectedIds, settingsOpen])
  const onLayoutChange = options?.onLayoutChange
  useEffect(() => {
    onLayoutChange?.({
      minimumWidth: libraryVisible ? (editorVisible ? 748 : 260) : editorVisible ? 480 : 260,
      libraryVisible,
      editorVisible,
    })
  }, [libraryVisible, editorVisible, onLayoutChange])
  const displayedLibraryWidth = editorVisible
    ? Math.max(260, Math.min(libraryWidth, availableWidth - 488))
    : availableWidth
  const drag = useRef<{ x: number; width: number } | null>(null)
  useEffect(() => {
    drag.current = null
  }, [libraryVisible, editorVisible])
  const clampWidth = (width: number) => Math.max(260, Math.min(480, width))
  const toggleEditor = () => {
    if (editorVisible) {
      rootRef.current?.dispatchEvent(
        new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }),
      )
      usePlaybackStore.getState().pause()
      const sourcePlayer = useSourcePlayerStore.getState()
      sourcePlayer.setPendingPlay(false)
      sourcePlayer.playerMethods?.pause()
    }
    setEditorVisible(!editorVisible)
  }
  const closeSettings = () => {
    setSettingsOpen(false)
    settingsTrigger.current?.focus()
  }
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" data-editor-workspace-shell>
      <nav
        aria-label={t('editor.refresh.columns')}
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs"
      >
        {options?.navigationActions}
        <details className="relative">
          <summary className="cursor-pointer rounded-md px-3 py-2 hover:bg-secondary">
            {t('editor.refresh.view')}
          </summary>
          <div className="absolute left-0 top-full z-50 rounded-lg border border-border bg-card p-2 shadow-xl">
            <button
              type="button"
              aria-pressed={metersOpen}
              className="whitespace-nowrap rounded-md px-3 py-2 hover:bg-secondary"
              onClick={() => setMetersOpen(!metersOpen)}
            >
              {t('editor.refresh.audioMeters')}
            </button>
          </div>
        </details>
        <button
          type="button"
          className="rounded-md px-3 py-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
          ref={libraryToggleRef}
          aria-pressed={libraryVisible}
          onClick={() => setLibraryVisible(!libraryVisible)}
        >
          {t(libraryVisible ? 'editor.refresh.hideLibrary' : 'editor.refresh.showLibrary')}
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
          aria-pressed={editorVisible}
          onClick={toggleEditor}
        >
          {t(editorVisible ? 'editor.refresh.hideEditor' : 'editor.refresh.showEditor')}
        </button>
        <button
          ref={settingsTrigger}
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => {
            settingsSelection.current = [...selectedIds]
            setSettingsNotice(false)
            setEditorVisible(true)
            setSettingsOpen(!settingsOpen)
          }}
          aria-expanded={settingsOpen}
        >
          <Settings2 className="h-4 w-4" />
          {t(selectedIds.length ? 'editor.refresh.clipSettings' : 'editor.refresh.canvasSettings')}
        </button>
      </nav>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <section
          aria-label={t('editor.refresh.library')}
          style={{
            width: displayedLibraryWidth,
            flexGrow: editorVisible ? 0 : 1,
            display: libraryVisible ? 'flex' : 'none',
          }}
          className="min-h-0 shrink-0 flex-col overflow-hidden rounded-lg bg-card"
          data-editor-column="library"
        >
          <MediaSidebar
            shellWidth={displayedLibraryWidth}
            onRequestClose={() => {
              setLibraryVisible(false)
              libraryToggleRef.current?.focus()
            }}
            transcriptActions={options?.transcriptActions}
          />
        </section>
        {libraryVisible && editorVisible && (
          <div
            role="separator"
            tabIndex={0}
            aria-label={t('editor.refresh.resizeLibrary')}
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={480}
            aria-valuenow={libraryWidth}
            className="w-2 shrink-0 cursor-col-resize touch-none bg-background hover:bg-border focus-visible:bg-primary focus-visible:outline-none"
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, width: libraryWidth }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (drag.current)
                setLibraryWidth(clampWidth(drag.current.width + event.clientX - drag.current.x))
            }}
            onPointerUp={() => {
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
            onLostPointerCapture={() => {
              drag.current = null
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                setLibraryWidth(clampWidth(libraryWidth + (event.key === 'ArrowRight' ? 16 : -16)))
              }
            }}
          />
        )}
        <section
          aria-label={t('editor.refresh.editor')}
          data-editor-column="editor"
          style={{ display: editorVisible ? 'flex' : 'none' }}
          className="relative min-h-0 min-w-[480px] flex-1 flex-col overflow-hidden rounded-lg bg-card"
        >
          {settingsNotice && (
            <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
              {t('editor.refresh.selectionChanged')}
            </p>
          )}
          {children}
          {metersOpen && (
            <aside
              aria-label={t('editor.refresh.audioMeters')}
              className="absolute right-3 top-3 z-40 h-[45%] overflow-hidden rounded-lg border border-border bg-card"
            >
              <AudioMeterPanel />
            </aside>
          )}
          {settingsOpen && (
            <section
              ref={settingsPanel}
              role="region"
              aria-label={t('editor.refresh.settings')}
              className="absolute right-3 top-3 z-40 flex max-h-[55%] w-[320px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  closeSettings()
                }
              }}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2 text-sm">
                <span>
                  {t(
                    selectedIds.length
                      ? 'editor.refresh.clipSettings'
                      : 'editor.refresh.canvasSettings',
                  )}
                </span>
                <button
                  autoFocus
                  type="button"
                  aria-label={t('editor.refresh.closeSettings')}
                  className="rounded-md p-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={closeSettings}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto">
                <PropertiesSidebar mobileDrawer onRequestClose={closeSettings} />
              </div>
            </section>
          )}
        </section>
        {!libraryVisible && !editorVisible && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {t('editor.refresh.restoreHint')}
          </div>
        )}
      </div>
    </div>
  )
}
