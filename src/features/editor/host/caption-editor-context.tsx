import { createContext, useContext, useMemo, type ReactNode } from 'react'

import {
  CaptionEditor,
  type CaptionCommandSubmitter,
  type CaptionDocumentPort,
} from '@/features/editor/codepress'
import type { EditApplyResult, EditCommandBatch } from '@/features/editor/codepress/contract'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorCapability } from './context'
import { hostSnapshotToControlledDocument } from './document'
import { EmbeddedEditorHostRuntime } from './runtime'

interface HostCaptionEditorValue {
  adapter: CaptionDocumentPort
  submit: CaptionCommandSubmitter
}

const HostCaptionEditorContext = createContext<HostCaptionEditorValue | null>(null)

function unsupportedResult(batch: EditCommandBatch, message: string): EditApplyResult {
  return {
    status: 'rejected',
    timeline_id: batch.timeline_id,
    operation_id: batch.operation_id,
    idempotency_key: batch.idempotency_key,
    base_revision: batch.base_revision,
    error: {
      code: 'unsupported_command',
      message,
      retryable: false,
      operation_id: batch.operation_id,
      details: { kind: 'generic', reason: message },
    },
  }
}

function createHostCaptionEditorValue(runtime: EmbeddedEditorHostRuntime): HostCaptionEditorValue {
  const adapter: CaptionDocumentPort = {
    getSnapshot() {
      const document = runtime.controller.getDocument()
      return { document, revision: document.timeline.revision }
    },
    subscribe(listener) {
      return runtime.controller.subscribe((snapshot) => {
        listener(hostSnapshotToControlledDocument(snapshot))
      })
    },
  }

  const submit: CaptionCommandSubmitter = async (batch) => {
    const result = await runtime.controller.submitEdit(batch)
    if (result.status === 'unsupported') return unsupportedResult(batch, result.reason)
    return result.result
  }

  return { adapter, submit }
}

export function HostCaptionEditorProvider({
  runtime,
  children,
}: {
  runtime: EmbeddedEditorHostRuntime
  children: ReactNode
}) {
  const value = useMemo(() => createHostCaptionEditorValue(runtime), [runtime])
  return (
    <HostCaptionEditorContext.Provider value={value}>{children}</HostCaptionEditorContext.Provider>
  )
}

function useHostCaptionEditorValue(): HostCaptionEditorValue | null {
  return useContext(HostCaptionEditorContext)
}

/**
 * Caption UI mounted inside the merged host-backed surface. It reads the
 * controller's authoritative document and submits the same host command path;
 * it never invents a project, duration, adapter, or persistence store.
 */
export function HostCaptionEditor() {
  const value = useHostCaptionEditorValue()
  const canEdit = useEditorCapability('timeline.caption')
  const currentFrame = usePlaybackStore((state) => state.currentFrame)
  const setCurrentFrame = usePlaybackStore((state) => state.setCurrentFrame)
  const loading = useTimelineSettingsStore((state) => state.isTimelineLoading)

  if (!value) return null

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="editor-caption-host">
      <CaptionEditor
        adapter={value.adapter}
        submit={canEdit ? value.submit : undefined}
        currentFrame={currentFrame}
        loading={loading}
        error={canEdit ? undefined : 'Caption editing is unavailable for this host.'}
        onSeek={setCurrentFrame}
      />
    </div>
  )
}
