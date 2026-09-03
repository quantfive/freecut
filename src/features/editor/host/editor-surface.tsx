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
import { HostCaptionEditorProvider } from './caption-editor-context'
import { HostTranscriptEditorProvider } from './transcript-editor-context'
import { EmbeddedEditorHostRuntime } from './runtime'
import { mountHostShortcutSettings } from './shortcut-settings'
import '@/index.css'

interface HostSurfaceState {
  snapshot: EmbeddedEditorSnapshot
  runtime: EmbeddedEditorHostRuntime
}

/**
 * Importable, host-backed browser entry for the real FreeCut editor tree.
 * Consumers provide authority and ports; this component provides only the
 * FreeCut providers, i18n, CSS, and existing LoadedEditor layout.
 *
 * The surface is embedded, so it fills the box the host hands it (`height:100%`)
 * instead of claiming the viewport. A host that reserves chrome of its own — a
 * fixed app header, say — sizes its own container; the surface never needs to
 * know that chrome exists, and never subtracts anything from `100vh`/`100dvh`.
 * The container must therefore have a definite height.
 */
export function FreeCutEditorSurface({ host }: { host: EditorHost }) {
  const [state, setState] = useState<HostSurfaceState | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let unmountShortcutSettings: (() => void) | undefined
    const shortcutSettingsAbortController = new AbortController()
    setState(null)
    setError(null)

    const initialize = async () => {
      unmountShortcutSettings = await mountHostShortcutSettings(
        host,
        shortcutSettingsAbortController.signal,
      )
      if (cancelled) {
        unmountShortcutSettings()
        unmountShortcutSettings = undefined
        return
      }

      const [snapshot] = await Promise.all([Promise.resolve(host.load()), i18nReady])
      if (!cancelled) {
        const runtime = new EmbeddedEditorHostRuntime(host, snapshot)
        // Host-pushed snapshots and submitted edits share one authoritative
        // controller, while shortcut settings retain their independent port.
        unsubscribe = host.subscribe?.((next) =>
          runtime.controller.replaceAuthoritativeSnapshot(next),
        )
        setState({ snapshot, runtime })
      }
    }

    void initialize()
      .then(() => undefined)
      .catch((caught) => {
        unsubscribe?.()
        unsubscribe = undefined
        shortcutSettingsAbortController.abort()
        unmountShortcutSettings?.()
        unmountShortcutSettings = undefined
        if (cancelled) return
        setError(caught instanceof Error ? caught : new Error(String(caught)))
      })

    return () => {
      cancelled = true
      unsubscribe?.()
      unsubscribe = undefined
      shortcutSettingsAbortController.abort()
      unmountShortcutSettings?.()
      unmountShortcutSettings = undefined
    }
  }, [host])

  if (error) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center bg-background p-6 text-sm text-destructive"
        role="alert"
      >
        {error.message}
      </div>
    )
  }

  if (!state) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center bg-background p-6 text-sm text-muted-foreground"
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
        <EditorHostProvider
          value={{
            mode: 'host',
            capabilities,
            host,
            timeline: {
              requestRippleDelete: state.runtime.requestRippleDelete,
              requestSetItemAttachment: (itemIds, rippleLinked) =>
                state.runtime.requestSetItemAttachment(itemIds, rippleLinked),
            },
          }}
        >
          <HostCaptionEditorProvider runtime={state.runtime}>
            <HostTranscriptEditorProvider runtime={state.runtime}>
              <ErrorBoundary level="feature">
                <div data-freecut-editor-surface="host" className="h-full min-h-0">
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
