import { useEffect, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GlobalTooltip } from '@/components/ui/global-tooltip'
import { ErrorBoundary } from '@/app/error-boundary'
import { i18n, i18nReady } from '@/i18n'
import { LoadedEditor } from '@/features/editor/components/editor'
import {
  DEFAULT_HOST_CAPABILITIES,
  isHostCapabilityEnabled,
  type EditorHost,
  type EmbeddedEditorSnapshot,
} from './contract'
import { EditorHostProvider } from './context-provider'
import { EmbeddedEditorHostRuntime } from './runtime'
import '@/index.css'

interface HostSurfaceState {
  snapshot: EmbeddedEditorSnapshot
  runtime: EmbeddedEditorHostRuntime
}

/**
 * Importable, host-backed browser entry for the real FreeCut editor tree.
 * Consumers provide authority and ports; this component provides only the
 * FreeCut providers, i18n, CSS, and existing LoadedEditor layout.
 */
export function FreeCutEditorSurface({ host }: { host: EditorHost }) {
  const [state, setState] = useState<HostSurfaceState | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setState(null)
    setError(null)
    void Promise.all([Promise.resolve(host.load()), i18nReady])
      .then(([snapshot]) => {
        if (cancelled) return
        setState({ snapshot, runtime: new EmbeddedEditorHostRuntime(host, snapshot) })
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught : new Error(String(caught)))
      })
    return () => {
      cancelled = true
    }
  }, [host])

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
        </EditorHostProvider>
        <GlobalTooltip />
      </TooltipProvider>
    </I18nextProvider>
  )
}
