// fallow-ignore-file unused-file
import { createRoot } from 'react-dom/client'
import { FreeCutEditorSurface } from '../../src/features/editor/host/editor-surface'
import type { EditorHost, EmbeddedEditorSnapshot } from '../../src/features/editor/host/contract'

declare global {
  interface Window {
    __freecutSourceRangeFixture: {
      pushRangeB(): void
      getLoadCount(): number
    }
  }
}

const MEDIA_ID = 'generated-av'
const ITEM_ID = 'retained-video'
const MEDIA_SOURCE = '/tests/browser/.source-range-generated.webm'

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
  capabilities: { 'media.resolve': true },
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

window.__freecutSourceRangeFixture = {
  pushRangeB() {
    currentSnapshot = snapshot(1, 60, 120)
    for (const listener of listeners) listener(currentSnapshot)
  },
  getLoadCount: () => loadCount,
}

const hostBox = document.querySelector<HTMLElement>('[data-host-box]')
if (!hostBox) throw new Error('Missing host box')
createRoot(hostBox).render(<FreeCutEditorSurface host={host} />)
