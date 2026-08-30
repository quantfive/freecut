// fallow-ignore-file unused-file

import { createRoot } from 'react-dom/client'
import { FreeCutEditorSurface } from '../../src/features/editor/host/editor-surface'
import type { EditorHost, EmbeddedEditorSnapshot } from '../../src/features/editor/host/contract'
import type { EditCommandBatch } from '../../src/features/editor/codepress/contract'
import { useSelectionStore } from '../../src/shared/state/selection'

declare global {
  interface Window {
    __freecutDeleteRippleFixture: {
      selectClip(): void
      rejectNextDelete(): void
      getLastBatch(): EditCommandBatch | null
      releaseReceipt(): void
    }
  }
}

const cohortItems = [
  { type: 'video' as const, id: 'video-1', trackId: 'video', mediaId: 'media-1' },
  { type: 'audio' as const, id: 'audio-1', trackId: 'audio', mediaId: 'media-2' },
  { type: 'caption_cue' as const, id: 'caption-1', trackId: 'captions' },
]

function fixtureSnapshot(revision = 0): EmbeddedEditorSnapshot {
  // fallow-ignore-next-line complexity
  const makeItems = (trackId: string) => {
    const cohort = cohortItems.find((item) => item.trackId === trackId)!
    const downstream =
      trackId === 'captions'
        ? { type: 'caption_cue' as const, id: 'caption-2', trackId, text: 'After' }
        : {
            type: trackId === 'video' ? ('video' as const) : ('audio' as const),
            id: `${trackId}-2`,
            trackId,
            mediaId: trackId === 'video' ? 'media-1' : 'media-2',
          }
    const items = [
      {
        ...cohort,
        from: 0,
        durationInFrames: 30,
        ...(cohort.type === 'caption_cue' ? { text: 'Before' } : {}),
        ...(cohort.type !== 'caption_cue' ? { sourceStart: 0, sourceEnd: 30 } : {}),
        linkedGroupId: 'cohort-1',
      },
      {
        ...downstream,
        from: 30,
        durationInFrames: 30,
        ...(downstream.type === 'caption_cue' ? { text: downstream.text } : {}),
        ...(downstream.type !== 'caption_cue' ? { sourceStart: 30, sourceEnd: 60 } : {}),
      },
    ]
    return revision === 0 ? items : [{ ...items[1]!, from: 0 }]
  }

  return {
    project: {
      id: 'delete-ripple-project',
      name: 'Delete Ripple QA',
      width: 640,
      height: 360,
      fps: 30,
    },
    timeline: {
      timelineId: 'delete-ripple-timeline',
      revision,
      fps: 30,
      durationInFrames: revision === 0 ? 90 : 60,
      media: [
        {
          media_id: 'media-1',
          media_kind: 'video',
          content_hash: 'qa-delete-ripple',
          duration_us: 3_000_000,
          availability: { mode: 'cloud', cloud: { object_id: 'qa-delete-ripple' } },
        },
        {
          media_id: 'media-2',
          media_kind: 'audio',
          content_hash: 'qa-delete-ripple-audio',
          duration_us: 3_000_000,
          availability: { mode: 'cloud', cloud: { object_id: 'qa-delete-ripple-audio' } },
        },
      ],
      tracks: ['video', 'audio', 'captions'].map((id) => ({
        id,
        kind:
          id === 'audio'
            ? ('audio' as const)
            : id === 'captions'
              ? ('caption' as const)
              : ('video' as const),
        name: id,
        locked: false,
        muted: false,
        syncLock: true,
        items: makeItems(id),
      })),
      width: 640,
      height: 360,
    },
    assets: [
      {
        id: 'media-1',
        kind: 'video',
        fileName: 'qa.mp4',
        mimeType: 'video/mp4',
        durationSeconds: 3,
        width: 640,
        height: 360,
        fps: 30,
      },
      {
        id: 'media-2',
        kind: 'audio',
        fileName: 'qa.mp3',
        mimeType: 'audio/mpeg',
        durationSeconds: 3,
        width: 0,
        height: 0,
        fps: 30,
      },
    ],
  }
}

let currentSnapshot = fixtureSnapshot()
let lastBatch: EditCommandBatch | null = null
let releaseReceipt: (() => void) | null = null
let rejectNextDelete = false

const host: EditorHost = {
  capabilities: { 'timeline.remove': true, 'media.resolve': false },
  load: () => currentSnapshot,
  resolveMedia: () => null,
  submitEdit: (batch) => {
    lastBatch = batch
    const command = batch.commands[0]
    if (command?.type !== 'ripple_delete') throw new Error('Expected ripple delete')
    if (rejectNextDelete) {
      rejectNextDelete = false
      return Promise.reject(new Error('Host rejected the timeline delete; retry is available'))
    }
    currentSnapshot = fixtureSnapshot(1)
    return new Promise((resolve) => {
      releaseReceipt = () => {
        releaseReceipt = null
        resolve({
          status: 'applied',
          snapshot: currentSnapshot,
          result: {
            status: 'applied',
            timeline_id: currentSnapshot.timeline.timelineId,
            operation_id: batch.operation_id,
            idempotency_key: batch.idempotency_key,
            base_revision: 0,
            previous_revision: 0,
            resulting_revision: 1,
            commands: batch.commands,
            effects: [],
            timeline: currentSnapshot.timeline,
          },
        })
      }
    })
  },
  notify: (notice) => {
    document.body.dataset.lastNotice = notice.message
  },
}

window.__freecutDeleteRippleFixture = {
  selectClip: () => useSelectionStore.getState().selectItems(['video-1']),
  rejectNextDelete: () => {
    rejectNextDelete = true
  },
  getLastBatch: () => lastBatch,
  releaseReceipt: () => releaseReceipt?.(),
}

const hostBox = document.querySelector<HTMLElement>('#host-box')
if (!hostBox) throw new Error('Missing host box')
createRoot(hostBox).render(<FreeCutEditorSurface host={host} />)
