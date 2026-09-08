// fallow-ignore-file unused-file
import { createRoot } from 'react-dom/client'
import { FreeCutEditorSurface } from '../../src/features/editor/host/editor-surface'
import {
  createCodePressCommandAdapter,
  controlledDocumentToFreeCutDocument,
  freeCutDocumentToControlledDocument,
} from '../../src/features/editor/codepress'
import type { EditorHost, EmbeddedEditorSnapshot } from '../../src/features/editor/host/contract'
import { hostSnapshotToNativeTimeline } from '../../src/features/editor/host/document'

const scenario = new URLSearchParams(location.search).get('scenario')
const clip = {
  id: 'first',
  type: 'video' as const,
  trackId: 'video',
  mediaId: 'fixture',
  from: 0,
  durationInFrames: 30,
  sourceStart: 0,
  sourceEnd: 30,
}
let snapshot: EmbeddedEditorSnapshot = {
  project: {
    id: 'caption-fixture',
    name: 'Caption fixture · edited sequence',
    width: 640,
    height: 360,
    fps: 30,
  },
  timeline: {
    timelineId: 'caption-timeline',
    revision: 0,
    fps: 30,
    width: 640,
    height: 360,
    durationInFrames: 150,
    media: [
      {
        media_id: 'fixture',
        media_kind: 'video',
        content_hash: 'fixture-hash',
        duration_us: 3_000_000,
        availability: { mode: 'cloud', cloud: { object_id: 'fixture' } },
      },
    ],
    tracks: [
      {
        id: 'video',
        kind: 'video',
        name: 'V1',
        locked: false,
        muted: false,
        items: [
          clip,
          { ...clip, id: 'after-cut', from: 30, sourceStart: 60, sourceEnd: 90 },
          { ...clip, id: 'repeat', from: 60, durationInFrames: 90, sourceEnd: 90 },
        ],
      },
    ],
  },
  assets: [
    {
      id: 'fixture',
      kind: 'video',
      fileName: 'generated-av.webm',
      mimeType: 'video/webm',
      durationSeconds: 3,
      width: 640,
      height: 360,
      fps: 30,
      contentHash: 'fixture-hash',
    },
  ],
}
let adapter = createCodePressCommandAdapter({
  document: freeCutDocumentToControlledDocument(snapshot.timeline),
})
const listeners = new Set<(value: EmbeddedEditorSnapshot) => void>()
const history: EmbeddedEditorSnapshot[] = []
const fixtureState = {
  applies: 0,
  undo: () => host.history!.undo(),
  requests: [] as unknown[],
  native: () => hostSnapshotToNativeTimeline(snapshot),
  snapshot: () => snapshot,
}
Object.assign(window, { captionFixture: fixtureState })
const host: EditorHost = {
  capabilities: { 'media.resolve': true, 'media.transcription': true, 'timeline.caption': true },
  load: () => snapshot,
  resolveMedia: () => ({ source: '/tests/browser/.caption-generated.webm' }),
  subscribe: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  history: {
    undo: () => {
      const previous = history.pop()
      if (previous) {
        snapshot = {
          ...previous,
          timeline: { ...previous.timeline, revision: snapshot.timeline.revision + 1 },
        }
        adapter = createCodePressCommandAdapter({
          document: freeCutDocumentToControlledDocument(snapshot.timeline),
        })
        listeners.forEach((listener) => listener(snapshot))
      }
    },
    redo: () => {},
  },
  submitEdit: (batch) => {
    const previous = snapshot
    const result = adapter.apply(batch)
    if (result.status !== 'rejected') {
      history.push(previous)
      fixtureState.applies++
      snapshot = {
        ...snapshot,
        timeline: controlledDocumentToFreeCutDocument(adapter.getDocument()),
      }
      listeners.forEach((listener) => listener(snapshot))
    }
    return { status: result.status, result, snapshot }
  },
  transcript: {
    occurrenceSelection: scenario !== 'unsupported',
    getStatus: () => ({
      transcriptId: 'transcript',
      assetId: 'fixture',
      sourceAssetHash: 'fixture-hash',
      status: scenario === 'pending' ? 'running' : scenario === 'missing' ? 'failed' : 'succeeded',
      durationUs: 3_000_000,
      sectionCount: 1,
    }),
    getSections: () => ({
      transcriptId: 'transcript',
      hasMore: false,
      sections: [
        {
          id: 'section',
          transcriptId: 'transcript',
          ordinal: 0,
          startUs: 0,
          endUs: 3_000_000,
          text: 'HELLO UM WORLD',
          timingSource: 'provider',
          words: [
            { text: 'HELLO', startUs: 0, endUs: 1_000_000 },
            { text: 'UM', startUs: 1_000_000, endUs: 2_000_000 },
            { text: 'WORLD', startUs: 2_000_000, endUs: 3_000_000 },
          ],
        },
      ],
    }),
    previewCommands: (request) => {
      if (scenario === 'error') throw new Error('Fixture preview unavailable. Retry preview.')
      fixtureState.requests.push(request)
      const trackId = request.captionTrackId!
      const existing = snapshot.timeline.tracks.find((track) => track.id === trackId)
      const cues = request.ranges!.map((range, index) => {
        const item = snapshot.timeline.tracks
          .flatMap((track) => track.items)
          .find((item) => item.id === range.itemId)!
        if (item.type !== 'video') throw new Error('Unsupported fixture')
        return {
          item_type: 'caption_cue' as const,
          cue_id: `cue-${index}`,
          track_id: trackId,
          start_us: Math.round(
            (item.from / 30) * 1_000_000 + range.startUs - (item.sourceStart! / 30) * 1_000_000,
          ),
          end_us: Math.round(
            (item.from / 30) * 1_000_000 + range.endUs - (item.sourceStart! / 30) * 1_000_000,
          ),
          text: range.text!,
        }
      })
      const commandBatch = {
        contract_version: 1 as const,
        timeline_id: snapshot.timeline.timelineId,
        operation_id: request.operationId,
        idempotency_key: request.idempotencyKey,
        base_revision: request.baseRevision,
        preconditions: [],
        commands: [
          ...(existing
            ? []
            : [
                {
                  type: 'add_caption_track' as const,
                  command_id: 'track',
                  track_id: trackId,
                  name: 'Captions',
                  language: 'en',
                  index: 1,
                },
              ]),
          { type: 'upsert_caption_cues' as const, command_id: 'cues', track_id: trackId, cues },
        ],
      }
      return {
        status: 'preview',
        receiptId: 'receipt',
        transcriptId: request.transcriptId,
        assetId: request.assetId,
        sourceAssetHash: request.sourceAssetHash,
        timestampCapability: 'section',
        timelineId: snapshot.timeline.timelineId,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        baseRevision: request.baseRevision,
        commandBatch,
        preview: { action: 'captions', captionCount: cues.length, willMutateTimeline: false },
      }
    },
  },
}
createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh', display: 'flex' }}>
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        padding: 20,
        background: '#f5f6f8',
        color: '#20242b',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h2>Conversation</h2>
      <p>Generated fixture. Keep captions in sync with my edit.</p>
      <textarea aria-label="Chat draft" style={{ marginTop: 'auto' }} />
    </aside>
    <main style={{ flex: 1, minWidth: 0 }}>
      <FreeCutEditorSurface host={host} />
    </main>
  </div>,
)
