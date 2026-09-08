// fallow-ignore-file unused-file
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FreeCutEditorSurface } from '../../src/features/editor/host/editor-surface'
import type { EditorHost, EmbeddedEditorSnapshot } from '../../src/features/editor/host/contract'

const MEDIA_ID = 'generated-av'
const ITEM_ID = 'retained-video'
const MEDIA_SOURCE = '/tests/browser/.layout-refresh-generated.webm'

function snapshot(
  revision: number,
  sourceStart: number,
  sourceEnd: number,
): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'source-range-project',
      name: 'Retained source range',
      width: 320,
      height: 180,
      fps: 30,
      backgroundColor: '#000000',
    },
    timeline: {
      timelineId: 'source-range-timeline',
      revision,
      fps: 30,
      durationInFrames: 60,
      media: [
        {
          media_id: MEDIA_ID,
          media_kind: 'video',
          content_hash: 'sha256:generated-source-range',
          duration_us: 4_000_000,
          availability: { mode: 'cloud', cloud: { object_id: 'generated-source-range' } },
        },
      ],
      tracks: [
        {
          id: 'video-track',
          kind: 'video',
          name: 'V1',
          locked: false,
          muted: false,
          items: [
            {
              id: ITEM_ID,
              type: 'video',
              trackId: 'video-track',
              mediaId: MEDIA_ID,
              from: 0,
              durationInFrames: 60,
              sourceStart,
              sourceEnd,
            },
          ],
        },
      ],
      width: 320,
      height: 180,
      backgroundColor: '#000000',
    },
    assets: [
      {
        id: MEDIA_ID,
        kind: 'video',
        fileName: 'generated-source-range.webm',
        mimeType: 'video/webm',
        durationSeconds: 4,
        width: 320,
        height: 180,
        fps: 30,
        contentHash: 'sha256:generated-source-range',
      },
    ],
  }
}

let currentSnapshot = snapshot(0, 0, 60)
let loadCount = 0
const listeners = new Set<(value: EmbeddedEditorSnapshot) => void>()

const host: EditorHost = {
  capabilities: { 'media.resolve': true, 'media.transcription': true },
  transcript: {
    getStatus: () => ({
      transcriptId: 'layout-transcript',
      assetId: MEDIA_ID,
      sourceAssetHash: 'sha256:generated-source-range',
      status: 'succeeded',
      durationUs: 4_000_000,
      sectionCount: 2,
    }),
    getSections: () => ({
      transcriptId: 'layout-transcript',
      hasMore: false,
      sections: [
        {
          id: 'section-one',
          transcriptId: 'layout-transcript',
          ordinal: 0,
          startUs: 0,
          endUs: 1_000_000,
          text: 'A calmer workspace makes room for your ideas.',
        },
        {
          id: 'section-two',
          transcriptId: 'layout-transcript',
          ordinal: 1,
          startUs: 1_000_000,
          endUs: 2_000_000,
          text: 'Keep the conversation beside the edit.',
        },
      ],
    }),
    search: () => ({ transcriptId: 'layout-transcript', query: '', hasMore: false, sections: [] }),
    previewCommands: () => {
      throw new Error('Read-only layout fixture')
    },
  },
  load: () => {
    loadCount += 1
    return currentSnapshot
  },
  resolveMedia: ({ mediaId }) => (mediaId === MEDIA_ID ? { source: MEDIA_SOURCE } : null),
  submitEdit: () => {
    throw new Error('The source-range fixture does not submit edits')
  },
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

function LayoutReview() {
  const [chatOpen, setChatOpen] = useState(true)
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 56, padding: 16, background: '#f5f6f8', color: '#14151a' }}>
        CodePress · Video editor · Layout fixture
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflowX: 'auto' }}>
        <aside
          aria-label="Chat"
          style={{
            display: chatOpen ? 'flex' : 'none',
            width: 300,
            flexShrink: 0,
            flexDirection: 'column',
            padding: 20,
            gap: 16,
            background: '#f5f6f8',
            color: '#14151a',
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              paddingBottom: 16,
              borderBottom: '1px solid #dde0e6',
            }}
          >
            Conversation
          </h2>
          <p>Keep the conversation beside the edit.</p>
          <p>Review the opening and tighten the pause.</p>
          <textarea
            aria-label="Chat draft"
            style={{
              marginTop: 'auto',
              width: '100%',
              minHeight: 160,
              padding: 16,
              border: '1px solid #d8dde4',
              borderRadius: 16,
              background: '#fff',
              boxShadow: '0 2px 8px #0000000a',
              fontSize: 14,
            }}
          />
        </aside>
        <div style={{ flex: 1, minWidth: 480 }}>
          <FreeCutEditorSurface
            host={host}
            shell={{
              navigationActions: (
                <button onClick={() => setChatOpen(!chatOpen)}>
                  {chatOpen ? 'Hide Chat' : 'Show Chat'}
                </button>
              ),
              headerActions: (
                <>
                  <button className="rounded-md border border-border px-3 py-2 text-sm">
                    Undo
                  </button>
                  <button className="rounded-md border border-border px-3 py-2 text-sm">
                    Redo
                  </button>
                  <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    Export
                  </button>
                </>
              ),
              transcriptActions: <p>Transcription controls remain mounted here.</p>,
            }}
          />
        </div>
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<LayoutReview />)
