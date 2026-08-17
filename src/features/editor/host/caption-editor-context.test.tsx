// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  controlledDocumentToFreeCutDocument,
  createCodePressCommandAdapter,
  freeCutDocumentToControlledDocument,
  type EditCommandBatch,
} from '@/features/editor/codepress'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { HostCaptionEditor, HostCaptionEditorProvider } from './caption-editor-context'
import { EditorHostProvider } from './context-provider'
import {
  DEFAULT_HOST_CAPABILITIES,
  type EditorHost,
  type EmbeddedEditorSnapshot,
  type HostEditResult,
} from './contract'
import { EmbeddedEditorHostRuntime } from './runtime'

function snapshot(): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'host-caption-project',
      name: 'Host captions',
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline: {
      timelineId: 'host-caption-timeline',
      revision: 0,
      fps: 30,
      durationInFrames: 180,
      media: [],
      tracks: [],
      width: 1920,
      height: 1080,
    },
    assets: [],
  }
}

function createHarness(initial: EmbeddedEditorSnapshot) {
  const remoteAdapter = createCodePressCommandAdapter({
    document: freeCutDocumentToControlledDocument(initial.timeline),
  })
  let remoteSnapshot = initial
  const submitEdit = vi.fn(async (batch: EditCommandBatch): Promise<HostEditResult> => {
    const result = remoteAdapter.apply(batch)
    if (result.status === 'rejected') {
      return {
        status: 'rejected',
        snapshot: remoteSnapshot,
        result,
      }
    }
    remoteSnapshot = {
      ...remoteSnapshot,
      timeline: controlledDocumentToFreeCutDocument(remoteAdapter.getDocument()),
    }
    return { status: result.status, snapshot: remoteSnapshot, result }
  })
  const host: EditorHost = {
    capabilities: DEFAULT_HOST_CAPABILITIES,
    load: () => initial,
    resolveMedia: () => null,
    submitEdit,
  }
  return { host, submitEdit, runtime: new EmbeddedEditorHostRuntime(host, initial) }
}

afterEach(() => cleanup())

describe('host-backed caption editor', () => {
  it('submits caption edits through the host controller instead of a local document', async () => {
    useTimelineSettingsStore.getState().setTimelineLoading(false)
    const harness = createHarness(snapshot())
    render(
      <EditorHostProvider
        value={{ mode: 'host', capabilities: DEFAULT_HOST_CAPABILITIES, host: harness.host }}
      >
        <HostCaptionEditorProvider runtime={harness.runtime}>
          <HostCaptionEditor />
        </HostCaptionEditorProvider>
      </EditorHostProvider>,
    )

    expect(await screen.findByTestId('caption-editor-empty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add caption track' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add cue' })).toBeInTheDocument())
    expect(harness.submitEdit).toHaveBeenCalledTimes(1)
    const trackBatch = harness.submitEdit.mock.calls[0]?.[0]
    expect(trackBatch).toMatchObject({
      base_revision: 0,
      commands: [{ type: 'add_caption_track' }],
    })
    expect(JSON.stringify(trackBatch)).not.toContain('_us')

    fireEvent.click(screen.getByRole('button', { name: 'Add cue' }))
    await waitFor(() => expect(screen.getByTestId(/caption-cue-/)).toBeInTheDocument())
    expect(harness.submitEdit).toHaveBeenCalledTimes(2)
    expect(harness.submitEdit.mock.calls[1]?.[0].commands[0]).toMatchObject({
      type: 'upsert_caption_cues',
    })
  })

  it('shows a capability error without enabling a bespoke local fallback', async () => {
    useTimelineSettingsStore.getState().setTimelineLoading(false)
    const initial = snapshot()
    const harness = createHarness(initial)
    const capabilities = { ...DEFAULT_HOST_CAPABILITIES, 'timeline.caption': false }
    render(
      <EditorHostProvider value={{ mode: 'host', capabilities, host: harness.host }}>
        <HostCaptionEditorProvider runtime={harness.runtime}>
          <HostCaptionEditor />
        </HostCaptionEditorProvider>
      </EditorHostProvider>,
    )

    expect(await screen.findByTestId('caption-editor-error')).toHaveTextContent(
      'Caption editing is unavailable for this host.',
    )
    expect(harness.submitEdit).not.toHaveBeenCalled()
  })
})
