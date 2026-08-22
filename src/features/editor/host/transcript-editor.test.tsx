// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

// The transcript tab renders inside the real MediaSidebar; the media library
// grid is unrelated to the tab lifecycle and stays stubbed out.
vi.mock('@/features/editor/deps/media-library', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/editor/deps/media-library')>()
  return {
    ...original,
    MediaLibrary: () => <div data-testid="media-library-stub" />,
  }
})

import {
  controlledDocumentToFreeCutDocument,
  createCodePressCommandAdapter,
  freeCutDocumentToControlledDocument,
  type EditCommandBatch,
} from '@/features/editor/codepress'
import { useEditorStore } from '@/shared/state/editor'
import { MediaSidebar } from '../components/media-sidebar'
import { EditorHostProvider } from './context-provider'
import {
  DEFAULT_HOST_CAPABILITIES,
  type EditorHost,
  type EmbeddedEditorSnapshot,
  type HostEditResult,
  type HostTranscriptCommandPreview,
  type HostTranscriptCommandPreviewRequest,
  type HostTranscriptSection,
  type HostTranscriptStatusReceipt,
} from './contract'
import { EmbeddedEditorHostRuntime } from './runtime'
import { HostTranscriptEditor } from './transcript-editor'
import { HostTranscriptEditorProvider } from './transcript-editor-context'

function snapshot(): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'host-transcript-project',
      name: 'Host transcript project',
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline: {
      timelineId: 'host-transcript-timeline',
      revision: 0,
      fps: 30,
      durationInFrames: 300,
      media: [],
      tracks: [],
      width: 1920,
      height: 1080,
    },
    assets: [],
  }
}

const sections: HostTranscriptSection[] = [
  {
    id: 'transcript-section-1',
    transcriptId: 'transcript-1',
    ordinal: 0,
    startUs: 1_000_000,
    endUs: 2_000_000,
    text: 'First bounded caption.',
    speaker: 'Speaker 1',
  },
  {
    id: 'transcript-section-2',
    transcriptId: 'transcript-1',
    ordinal: 1,
    startUs: 4_000_000,
    endUs: 5_000_000,
    text: 'Second bounded caption.',
    speaker: 'Speaker 1',
  },
]

function createHarness(
  initial: EmbeddedEditorSnapshot,
  transcriptStatus:
    | 'pending'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'stale'
    | 'purged' = 'succeeded',
  previewStatus: 'preview' | 'replayed' = 'preview',
  conflictOnApply = false,
  previewTimestampCapability: 'section' | 'word' = 'section',
) {
  const remoteAdapter = createCodePressCommandAdapter({
    document: freeCutDocumentToControlledDocument(initial.timeline),
  })
  let remoteSnapshot = initial
  const submitEdit = vi.fn(async (batch: EditCommandBatch): Promise<HostEditResult> => {
    if (conflictOnApply) {
      return {
        status: 'conflict',
        snapshot: remoteSnapshot,
        result: {
          status: 'rejected',
          timeline_id: initial.timeline.timelineId,
          operation_id: batch.operation_id,
          idempotency_key: batch.idempotency_key,
          base_revision: batch.base_revision,
          error: {
            code: 'revision_conflict',
            message: 'The timeline changed before this transcript edit was applied.',
            retryable: true,
            operation_id: batch.operation_id,
            details: {
              kind: 'revision_conflict',
              base_revision: batch.base_revision,
              current_revision: batch.base_revision + 1,
              rebase: {
                status: 'required',
                automatic: false,
                strategy: 'refresh_then_resubmit',
                retry_with_revision: batch.base_revision + 1,
              },
            },
          },
        },
      }
    }
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

  const previewBatch: EditCommandBatch = {
    contract_version: 1,
    timeline_id: initial.timeline.timelineId,
    operation_id: 'transcript-preview-operation',
    idempotency_key: 'transcript-preview-idempotency',
    base_revision: 0,
    preconditions: [],
    commands: [
      {
        command_id: 'add-transcript-track',
        type: 'add_caption_track',
        track_id: 'host-transcript-captions',
        name: 'Transcript captions',
        language: 'en',
        index: 0,
      },
      {
        command_id: 'upsert-transcript-cues',
        type: 'upsert_caption_cues',
        track_id: 'host-transcript-captions',
        cues: [
          {
            item_type: 'caption_cue',
            cue_id: 'transcript-cue-1',
            track_id: 'host-transcript-captions',
            start_us: sections[0]!.startUs,
            end_us: sections[0]!.endUs,
            text: sections[0]!.text,
            speaker: sections[0]!.speaker,
          },
        ],
      },
    ],
  }

  // The CodePress adapter maps both `cut` and `ripple_cut` onto one normalized
  // `cut` action whose batch is made of `ripple_delete` commands.
  const cutBatch: EditCommandBatch = {
    contract_version: 1,
    timeline_id: initial.timeline.timelineId,
    operation_id: 'transcript-preview-operation',
    idempotency_key: 'transcript-preview-idempotency',
    base_revision: 0,
    preconditions: [],
    commands: [
      {
        command_id: 'transcript-cut-1',
        type: 'ripple_delete',
        start_us: sections[0]!.startUs,
        end_us: sections[0]!.endUs,
        track_ids: null,
      },
    ],
  }

  const previewCommands = vi.fn(
    async (request: HostTranscriptCommandPreviewRequest): Promise<HostTranscriptCommandPreview> => {
      const isCut = request.action === 'cut' || request.action === 'ripple_cut'
      return {
        status: previewStatus,
        receiptId: 'transcript-receipt-1',
        transcriptId: 'transcript-1',
        assetId: 'asset-1',
        sourceAssetHash: 'sha256:source-1',
        timestampCapability:
          previewTimestampCapability as HostTranscriptCommandPreview['timestampCapability'],
        timelineId: initial.timeline.timelineId,
        operationId: previewBatch.operation_id,
        idempotencyKey: previewBatch.idempotency_key,
        baseRevision: 0,
        commandBatch: isCut ? cutBatch : previewBatch,
        preview: isCut
          ? { action: 'cut', selectionCount: 1, willMutateTimeline: false }
          : { action: 'captions', captionCount: 1, willMutateTimeline: false },
      }
    },
  )

  const host: EditorHost = {
    capabilities: {
      ...DEFAULT_HOST_CAPABILITIES,
      'media.transcription': true,
      'timeline.caption': true,
    },
    load: () => initial,
    resolveMedia: () => null,
    submitEdit,
    transcript: {
      getStatus: vi.fn(() =>
        transcriptStatus === 'succeeded'
          ? {
              transcriptId: 'transcript-1',
              assetId: 'asset-1',
              sourceAssetHash: 'sha256:source-1',
              status: 'succeeded' as const,
              language: 'en',
              durationUs: 10_000_000,
              sectionCount: sections.length,
              error: null,
            }
          : {
              transcriptId: 'transcript-1',
              assetId: 'asset-1',
              sourceAssetHash: 'sha256:source-1',
              status: transcriptStatus,
              language: 'en',
              durationUs: 10_000_000,
              sectionCount: 0,
              error:
                transcriptStatus === 'pending' || transcriptStatus === 'running'
                  ? {
                      code: 'transcript_not_ready',
                      message: 'The transcript is not ready for command conversion.',
                      retryable: true,
                    }
                  : {
                      code: 'transcript_content_unavailable',
                      message: 'Transcript sections are no longer available.',
                      retryable: false,
                    },
            },
      ),
      getSections: vi.fn(() => ({
        transcriptId: 'transcript-1',
        sections,
        hasMore: false,
        nextCursor: null,
      })),
      previewCommands,
    },
  }
  return {
    host,
    runtime: new EmbeddedEditorHostRuntime(host, initial),
    submitEdit,
    previewCommands,
  }
}

function renderHostEditor(harness: ReturnType<typeof createHarness>) {
  return render(
    <EditorHostProvider
      value={{ mode: 'host', capabilities: harness.host.capabilities, host: harness.host }}
    >
      <HostTranscriptEditorProvider runtime={harness.runtime}>
        <HostTranscriptEditor />
      </HostTranscriptEditorProvider>
    </EditorHostProvider>,
  )
}

function receipt(
  status: HostTranscriptStatusReceipt['status'],
  overrides: Partial<HostTranscriptStatusReceipt> = {},
): HostTranscriptStatusReceipt {
  return {
    transcriptId: 'transcript-1',
    assetId: 'asset-1',
    sourceAssetHash: 'sha256:source-1',
    status,
    language: 'en',
    durationUs: 10_000_000,
    sectionCount: status === 'succeeded' ? sections.length : 0,
    error: null,
    ...overrides,
  }
}

function previewCommandsFor(
  harness: ReturnType<typeof createHarness>,
  request: HostTranscriptCommandPreviewRequest,
  action: HostTranscriptCommandPreviewRequest['action'],
): Promise<HostTranscriptCommandPreview> {
  return harness.previewCommands({ ...request, action })
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('host-backed transcript consumer', () => {
  it('displays bounded sections, previews without mutation, then applies through submitEdit', async () => {
    const harness = createHarness(snapshot())
    renderHostEditor(harness)

    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    expect(screen.getByTestId('host-transcript-preview-button')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))
    await waitFor(() => expect(screen.getByTestId('host-transcript-preview')).toBeInTheDocument())

    expect(harness.previewCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptId: 'transcript-1',
        assetId: 'asset-1',
        sourceAssetHash: 'sha256:source-1',
        timestampCapability: 'section',
        ranges: [
          {
            startUs: 1_000_000,
            endUs: 2_000_000,
            text: 'First bounded caption.',
          },
        ],
      }),
    )
    expect(harness.submitEdit).not.toHaveBeenCalled()
    expect(JSON.stringify(harness.previewCommands.mock.calls[0]?.[0])).not.toMatch(
      /https?:|\/Users\/|Bearer|provider|upload_url|media_bytes/i,
    )

    fireEvent.click(screen.getByTestId('host-transcript-apply'))
    await waitFor(() => expect(harness.submitEdit).toHaveBeenCalledTimes(1))
    expect(harness.submitEdit.mock.calls[0]?.[0].commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'add_caption_track' }),
        expect.objectContaining({ type: 'upsert_caption_cues' }),
      ]),
    )
  })

  it('cuts the selection through the same preview-then-submitEdit path', async () => {
    const harness = createHarness(snapshot())
    renderHostEditor(harness)

    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-cut-button'))
    await waitFor(() => expect(screen.getByTestId('host-transcript-preview')).toBeInTheDocument())

    expect(harness.previewCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cut',
        transcriptId: 'transcript-1',
        assetId: 'asset-1',
        timestampCapability: 'section',
        ranges: [{ startUs: 1_000_000, endUs: 2_000_000, text: 'First bounded caption.' }],
      }),
    )
    expect(harness.submitEdit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('host-transcript-apply'))
    await waitFor(() => expect(harness.submitEdit).toHaveBeenCalledTimes(1))
    expect(harness.submitEdit.mock.calls[0]?.[0].commands).toEqual([
      expect.objectContaining({ type: 'ripple_delete' }),
    ])
    await waitFor(() => expect(screen.getByText('Transcript cut applied.')).toBeInTheDocument())
  })

  it('rejects a captions preview that comes back as a ripple_delete batch', async () => {
    const harness = createHarness(snapshot())
    // The host answers a captions request with a cut batch. Every command in it
    // is capability-enabled now that ripple_delete maps to timeline.remove, so
    // the capability gate alone would let it through and label it "Apply
    // captions" over a batch that deletes timeline content.
    harness.host.transcript!.previewCommands = vi.fn(
      async (
        request: HostTranscriptCommandPreviewRequest,
      ): Promise<HostTranscriptCommandPreview> => ({
        status: 'preview',
        receiptId: 'transcript-receipt-1',
        transcriptId: 'transcript-1',
        assetId: 'asset-1',
        sourceAssetHash: 'sha256:source-1',
        timestampCapability: 'section',
        timelineId: snapshot().timeline.timelineId,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        baseRevision: 0,
        commandBatch: {
          contract_version: 1,
          timeline_id: snapshot().timeline.timelineId,
          operation_id: request.operationId,
          idempotency_key: request.idempotencyKey,
          base_revision: 0,
          preconditions: [],
          commands: [
            {
              command_id: 'smuggled-cut',
              type: 'ripple_delete',
              start_us: sections[0]!.startUs,
              end_us: sections[0]!.endUs,
              track_ids: null,
            },
          ],
        },
        preview: { action: 'captions', captionCount: 1, willMutateTimeline: false },
      }),
    )

    renderHostEditor(harness)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))

    await waitFor(() =>
      expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
        'non-caption timeline commands',
      ),
    )
    // No preview is stored, so there is nothing to apply and nothing is deleted.
    expect(screen.queryByTestId('host-transcript-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('host-transcript-apply')).not.toBeInTheDocument()
    expect(harness.submitEdit).not.toHaveBeenCalled()
    // The validation error is terminal — it must not offer a retry.
    expect(within(screen.getByTestId('host-transcript-error')).queryByText('Retry')).toBeNull()
  })

  it('rejects a cut preview whose batch is not in the cut command family', async () => {
    const harness = createHarness(snapshot())
    // Echo the requested action back correctly so the family check — not the
    // action echo — is what refuses this batch.
    harness.host.transcript!.previewCommands = vi.fn(async (request) => {
      const captions = await previewCommandsFor(harness, request, 'captions')
      return { ...captions, preview: { ...captions.preview, action: 'cut' as const } }
    })

    renderHostEditor(harness)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-cut-button'))

    await waitFor(() =>
      expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
        'non-cut timeline commands',
      ),
    )
    expect(screen.queryByTestId('host-transcript-preview')).not.toBeInTheDocument()
    expect(harness.submitEdit).not.toHaveBeenCalled()
  })

  it('rejects a preview whose echoed action disagrees with the requested one', async () => {
    const harness = createHarness(snapshot())
    // Right command family, wrong echoed action.
    harness.host.transcript!.previewCommands = vi.fn(async (request) => {
      const captions = await previewCommandsFor(harness, request, 'captions')
      return { ...captions, preview: { ...captions.preview, action: 'cut' as const } }
    })

    renderHostEditor(harness)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))

    await waitFor(() =>
      expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
        'different action than the one requested',
      ),
    )
    expect(screen.queryByTestId('host-transcript-preview')).not.toBeInTheDocument()
    expect(harness.submitEdit).not.toHaveBeenCalled()
  })

  it('offers Transcribe only when the port implements it and polls the host to succeeded', async () => {
    const without = createHarness(snapshot(), 'failed')
    renderHostEditor(without)
    expect(await screen.findByTestId('host-transcript-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('host-transcript-transcribe')).not.toBeInTheDocument()
    cleanup()

    vi.stubEnv('VITE_HOST_TRANSCRIBE_POLL_MS', '1')
    const harness = createHarness(snapshot(), 'failed')
    let requested = false
    let polls = 0
    harness.host.transcript!.getStatus = vi.fn(() => {
      if (!requested) {
        return receipt('failed', {
          error: {
            code: 'transcript_content_unavailable',
            message: 'Transcript sections are no longer available.',
            retryable: false,
          },
        })
      }
      polls += 1
      return receipt(polls >= 2 ? 'succeeded' : 'running')
    })
    const requestTranscription = vi.fn(() => {
      requested = true
      return receipt('pending')
    })
    harness.host.transcript!.requestTranscription = requestTranscription

    renderHostEditor(harness)
    fireEvent.click(await screen.findByTestId('host-transcript-transcribe'))

    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    expect(requestTranscription).toHaveBeenCalledWith({ assetId: 'asset-1', language: 'en' })
    expect(polls).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('host-transcript-status')).toHaveTextContent('succeeded')
  })

  it('hides Transcribe when the transcription capability is off', async () => {
    const harness = createHarness(snapshot(), 'failed')
    harness.host.transcript!.requestTranscription = vi.fn(() => receipt('pending'))
    const capabilities = { ...harness.host.capabilities, 'media.transcription': false }
    render(
      <EditorHostProvider value={{ mode: 'host', capabilities, host: harness.host }}>
        <HostTranscriptEditorProvider runtime={harness.runtime}>
          <HostTranscriptEditor />
        </HostTranscriptEditorProvider>
      </EditorHostProvider>,
    )
    expect(await screen.findByTestId('host-transcript-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('host-transcript-transcribe')).not.toBeInTheDocument()
  })

  it('surfaces replay receipts and clears a stale preview on apply conflict', async () => {
    const replayed = createHarness(snapshot(), 'succeeded', 'replayed')
    renderHostEditor(replayed)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))
    await waitFor(() => expect(screen.getByText('Preview replayed safely.')).toBeInTheDocument())

    cleanup()
    const stale = createHarness(snapshot(), 'succeeded', 'preview', true)
    renderHostEditor(stale)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))
    await waitFor(() => expect(screen.getByTestId('host-transcript-preview')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('host-transcript-apply'))
    await waitFor(() =>
      expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
        'timeline changed before this transcript edit was applied',
      ),
    )
    expect(screen.queryByTestId('host-transcript-preview')).not.toBeInTheDocument()
  })

  it('fails closed for unsupported timestamp previews and oversized pages', async () => {
    const unsupported = createHarness(snapshot(), 'succeeded', 'preview', false, 'word')
    renderHostEditor(unsupported)
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))
    await waitFor(() =>
      expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
        'could not be prepared',
      ),
    )
    expect(unsupported.submitEdit).not.toHaveBeenCalled()

    cleanup()
    const oversized = createHarness(snapshot())
    oversized.host.transcript!.getSections = vi.fn(() => ({
      transcriptId: 'transcript-1',
      sections: Array.from({ length: 51 }, (_, index) => ({
        ...sections[0]!,
        id: `oversized-section-${index}`,
        ordinal: index,
        startUs: index * 1_000,
        endUs: index * 1_000 + 500,
      })),
      hasMore: false,
      nextCursor: null,
    }))
    renderHostEditor(oversized)
    expect(await screen.findByTestId('host-transcript-unavailable')).toHaveTextContent(
      'could not be loaded',
    )
    expect(oversized.previewCommands).not.toHaveBeenCalled()
  })

  it('keeps pending and running states retryable and terminal states fail closed', async () => {
    const states = [
      { status: 'pending' as const, retryable: true, message: 'not ready for command conversion' },
      { status: 'running' as const, retryable: true, message: 'not ready for command conversion' },
      { status: 'failed' as const, retryable: false, message: 'no longer available' },
      { status: 'stale' as const, retryable: false, message: 'no longer available' },
      { status: 'purged' as const, retryable: false, message: 'no longer available' },
    ]

    for (const state of states) {
      const harness = createHarness(snapshot(), state.status)
      renderHostEditor(harness)
      expect(await screen.findByTestId('host-transcript-unavailable')).toHaveTextContent(
        state.message,
      )
      if (state.retryable) {
        expect(screen.getByTestId('host-transcript-retry')).toBeInTheDocument()
      } else {
        expect(screen.queryByTestId('host-transcript-retry')).not.toBeInTheDocument()
      }
      expect(harness.host.transcript?.getSections).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('fails closed for malformed host sections and does not import local transcript services', async () => {
    const harness = createHarness(snapshot())
    harness.host.transcript!.getSections = vi.fn(() => ({
      transcriptId: 'transcript-1',
      sections: [
        {
          ...sections[0]!,
          endUs: sections[0]!.startUs,
        },
      ],
      hasMore: false,
      nextCursor: null,
    }))
    renderHostEditor(harness)
    expect(await screen.findByTestId('host-transcript-unavailable')).toHaveTextContent(
      'could not be loaded',
    )
    expect(harness.previewCommands).not.toHaveBeenCalled()

    const source = readFileSync('src/features/editor/host/transcript-editor.tsx', 'utf8')
    expect(source).not.toMatch(
      /mediaTranscriptionService|useTranscriptIgnoreStore|loadTimeline|saveTimeline/,
    )
  })
})

describe('transcript tab across authoritative snapshots (real MediaSidebar path)', () => {
  function renderRealSidebar(harness: ReturnType<typeof createHarness>) {
    harness.runtime.mountStores()
    return render(
      <EditorHostProvider
        value={{ mode: 'host', capabilities: harness.host.capabilities, host: harness.host }}
      >
        <HostTranscriptEditorProvider runtime={harness.runtime}>
          <MediaSidebar />
        </HostTranscriptEditorProvider>
      </EditorHostProvider>,
    )
  }

  async function drivePreviewAndApply() {
    act(() => {
      useEditorStore.getState().setActiveTab('transcript')
    })
    expect(
      await screen.findByTestId('host-transcript-section-transcript-section-1'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-transcript-section-transcript-section-1'))
    fireEvent.click(screen.getByTestId('host-transcript-preview-button'))
    await waitFor(() => expect(screen.getByTestId('host-transcript-preview')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('host-transcript-apply'))
  }

  afterEach(() => {
    useEditorStore.setState({ activeTab: 'media' })
  })

  it('keeps the transcript panel mounted with its applied state after apply', async () => {
    const harness = createHarness(snapshot())
    try {
      renderRealSidebar(harness)
      await drivePreviewAndApply()
      await waitFor(() => expect(harness.submitEdit).toHaveBeenCalledTimes(1))
      // Installing the authoritative snapshot must not unmount the panel.
      expect(useEditorStore.getState().activeTab).toBe('transcript')
      expect(screen.getByTestId('host-transcript-editor')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByText('Transcript captions applied.')).toBeInTheDocument(),
      )
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('keeps the transcript panel mounted with the inline revision-conflict error', async () => {
    const harness = createHarness(snapshot(), 'succeeded', 'preview', true)
    try {
      renderRealSidebar(harness)
      await drivePreviewAndApply()
      await waitFor(() =>
        expect(screen.getByTestId('host-transcript-error')).toHaveTextContent(
          'timeline changed before this transcript edit was applied',
        ),
      )
      expect(useEditorStore.getState().activeTab).toBe('transcript')
      expect(screen.getByTestId('host-transcript-editor')).toBeInTheDocument()
      expect(screen.queryByTestId('host-transcript-preview')).not.toBeInTheDocument()
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('still resets a sidebar tab that host mode does not show', () => {
    const harness = createHarness(snapshot())
    try {
      act(() => {
        useEditorStore.getState().setActiveTab('effects')
      })
      harness.runtime.mountStores()
      expect(useEditorStore.getState().activeTab).toBe('media')
    } finally {
      harness.runtime.unmountStores()
    }
  })
})
