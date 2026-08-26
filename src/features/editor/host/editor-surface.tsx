import { useEffect, useState, type RefObject } from 'react'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GlobalTooltip } from '@/components/ui/global-tooltip'
import { ErrorBoundary } from '@/app/error-boundary'
import { i18n, i18nReady } from '@/i18n'
import { LoadedEditor } from '@/features/editor/components/editor'
import { useEditorStore } from '@/shared/state/editor'
import {
  DEFAULT_HOST_CAPABILITIES,
  isHostCapabilityEnabled,
  type EditorHost,
  type EmbeddedEditorSnapshot,
} from './contract'
import { EditorHostProvider } from './context-provider'
import { HostCaptionEditorProvider } from './caption-editor-context'
import { HostTranscriptEditorProvider } from './transcript-editor-context'
import { EmbeddedEditorHostRuntime } from './runtime'
import { isHostRailTab } from './sidebar-rail'
import '@/index.css'

interface HostSurfaceState {
  snapshot: EmbeddedEditorSnapshot
  runtime: EmbeddedEditorHostRuntime
}

/**
 * Imperative handle the host receives through `apiRef`.  Lets the host drive
 * the sidebar without reaching into editor stores — e.g. auto-opening a
 * registered sidebar module when host-side work needs attention.
 */
export interface FreeCutEditorSurfaceApi {
  /**
   * Select a registered `sidebarModules` entry's tab and open the panel.
   * No-ops for an id the host never registered, and for one its `sidebarRail`
   * suppresses — opening a tab with no rail button would strand the user, and
   * the next authoritative snapshot would reset it anyway.
   */
  openSidebarModule(id: string): void
  /** Close the left sidebar panel. */
  closeSidebar(): void
}

interface FreeCutEditorSurfaceProps {
  host: EditorHost
  apiRef?: RefObject<FreeCutEditorSurfaceApi | null>
}

/**
 * Importable, host-backed browser entry for the real FreeCut editor tree.
 * Consumers provide authority and ports; this component provides only the
 * FreeCut providers, i18n, CSS, and existing LoadedEditor layout.
 */
export function FreeCutEditorSurface({ host, apiRef }: FreeCutEditorSurfaceProps) {
  const [state, setState] = useState<HostSurfaceState | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    setState(null)
    setError(null)
    void Promise.all([Promise.resolve(host.load()), i18nReady])
      .then(([snapshot]) => {
        if (cancelled) return
        const runtime = new EmbeddedEditorHostRuntime(host, snapshot)
        // An out-of-band host revision enters through the same controller the
        // result of a submitted edit does, so the surface adopts it in place
        // rather than being remounted with a new `host`.
        unsubscribe = host.subscribe?.((next) =>
          runtime.controller.replaceAuthoritativeSnapshot(next),
        )
        setState({ snapshot, runtime })
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught : new Error(String(caught)))
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      unsubscribe = undefined
    }
  }, [host])

  // The host drives its registered sidebar modules through `apiRef` over the
  // same editor store the MediaSidebar reads, rather than reaching into the
  // store itself.  Opening fails closed for any tab the rail does not show.
  useEffect(() => {
    if (!apiRef || !state) return
    apiRef.current = {
      openSidebarModule: (id) => {
        if (!isHostRailTab(`host:${id}`, host)) return
        const { setActiveTab, toggleLeftSidebar } = useEditorStore.getState()
        setActiveTab(`host:${id}`)
        if (!useEditorStore.getState().leftSidebarOpen) toggleLeftSidebar()
      },
      closeSidebar: () => {
        const store = useEditorStore.getState()
        if (store.leftSidebarOpen) store.toggleLeftSidebar()
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, state, host])

  if (error) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-destructive"
        role="alert"
      >
        {error.message}
      </div>
    )
  }

  if (!state) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground"
        aria-busy="true"
      >
        Loading editor…
      </div>
    )
  }

  const capabilities = { ...DEFAULT_HOST_CAPABILITIES, ...host.capabilities }
  const onNavigateBack =
    host.navigation && isHostCapabilityEnabled(capabilities, 'project.navigate')
      ? () => host.navigation!.back()
      : undefined
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={300}>
        <EditorHostProvider value={{ mode: 'host', capabilities, host }}>
          <HostCaptionEditorProvider runtime={state.runtime}>
            <HostTranscriptEditorProvider runtime={state.runtime}>
              <ErrorBoundary level="feature">
                <div data-freecut-editor-surface="host" className="h-screen min-h-0">
                  <LoadedEditor
                    projectId={state.snapshot.project.id}
                    project={state.snapshot.project}
                    migration={{
                      storedSchemaVersion: 1,
                      currentSchemaVersion: 1,
                      requiresUpgrade: false,
                    }}
                    hostRuntime={state.runtime}
                    onNavigateBack={onNavigateBack}
                  />
                </div>
              </ErrorBoundary>
            </HostTranscriptEditorProvider>
          </HostCaptionEditorProvider>
        </EditorHostProvider>
        <GlobalTooltip />
      </TooltipProvider>
    </I18nextProvider>
  )
}
