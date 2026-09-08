import { describe, expect, it } from 'vite-plus/test'
import { deriveSupportedHostEdit } from './controller'
import { createCodePressCommandAdapter, freeCutDocumentToControlledDocument } from '../codepress'
import type { EmbeddedEditorSnapshot } from './contract'
import { hostSnapshotToNativeTimeline, nativeTimelineToFrameDocument } from './document'

const snapshot: EmbeddedEditorSnapshot = {
  project: { id: 'project', name: 'Captions', width: 640, height: 360, fps: 30 },
  assets: [],
  timeline: {
    timelineId: 'timeline',
    revision: 2,
    fps: 30,
    width: 640,
    height: 360,
    durationInFrames: 60,
    media: [],
    tracks: [
      {
        id: 'captions',
        name: 'Captions',
        kind: 'caption',
        locked: false,
        muted: false,
        defaultStyle: { color: '#ffff00', font_size: 48 },
        items: [
          {
            id: 'cue',
            type: 'caption_cue',
            trackId: 'captions',
            from: 30,
            durationInFrames: 30,
            text: 'WORLD',
          },
          {
            id: 'override',
            type: 'caption_cue',
            trackId: 'captions',
            from: 0,
            durationInFrames: 30,
            text: 'HELLO',
            style: { color: '#ff0000', background_opacity: 0 },
          },
        ],
      },
    ],
  },
}
describe('caption render contract', () => {
  it('projects track defaults and cue overrides into real preview/export text', () => {
    const native = hostSnapshotToNativeTimeline(snapshot)
    expect(native.items[0]).toMatchObject({
      type: 'text',
      text: 'WORLD',
      color: '#ffff00',
      fontSize: 48,
      from: 30,
      durationInFrames: 30,
    })
    expect(native.items[1]).toMatchObject({ color: '#ff0000', fontSize: 48 })
    expect(native.items[1]).toMatchObject({ backgroundOpacity: 0 })
    const restored = nativeTimelineToFrameDocument(native, snapshot.timeline)
    expect(restored.ok).toBe(true)
    if (restored.ok)
      expect(restored.document.tracks[0]!.items).toEqual(snapshot.timeline.tracks[0]!.items)
  })
  it.each(['#ffff00', '#ffffff'])(
    'keeps explicit %s override equal to the default when the default later changes',
    (color) => {
      const track = snapshot.timeline.tracks[0]!
      const original = {
        ...snapshot,
        timeline: {
          ...snapshot.timeline,
          tracks: [
            {
              ...track,
              defaultStyle: { color, background_opacity: 0 },
              items: [{ ...track.items[0]!, style: { color, background_opacity: 0 } }],
            },
          ],
        },
      }
      const native = hostSnapshotToNativeTimeline(original)
      const restored = nativeTimelineToFrameDocument(native, original.timeline)
      expect(restored.ok).toBe(true)
      if (!restored.ok) return
      const changed = hostSnapshotToNativeTimeline({
        ...original,
        timeline: {
          ...restored.document,
          tracks: restored.document.tracks.map((candidate) => ({
            ...candidate,
            defaultStyle: { color: '#ff0000', background_opacity: 1 },
          })),
        },
      })
      expect(changed.items[0]).toMatchObject({ color, backgroundOpacity: 0 })
    },
  )
  it('derives and applies a subsequent clip trim without turning inherited styles into edits', () => {
    const original: EmbeddedEditorSnapshot = {
      ...snapshot,
      timeline: {
        ...snapshot.timeline,
        media: [
          {
            media_id: 'media',
            media_kind: 'video',
            content_hash: 'hash',
            duration_us: 3_000_000,
            availability: { mode: 'cloud', cloud: { object_id: 'media' } },
          },
        ],
        tracks: [
          ...snapshot.timeline.tracks,
          {
            id: 'video',
            kind: 'video',
            name: 'Video',
            locked: false,
            muted: false,
            items: [
              {
                type: 'video',
                id: 'clip',
                trackId: 'video',
                mediaId: 'media',
                from: 0,
                durationInFrames: 60,
                sourceStart: 0,
                sourceEnd: 60,
              },
            ],
          },
        ],
      },
    }
    const native = hostSnapshotToNativeTimeline(original)
    const edited = nativeTimelineToFrameDocument(
      {
        ...native,
        items: native.items.map((item) =>
          item.id === 'clip' ? { ...item, from: 5, durationInFrames: 55, sourceStart: 5 } : item,
        ),
      },
      original.timeline,
    )
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    const derived = deriveSupportedHostEdit(original.timeline, edited.document)
    expect(derived.batch?.commands.map((command) => command.type)).toEqual(['trim_item'])
    const adapter = createCodePressCommandAdapter({
      document: freeCutDocumentToControlledDocument(original.timeline),
    })
    const captionsBeforeTrim = adapter.getDocument().timeline.tracks[0]
    expect(adapter.apply(derived.batch).status).toBe('applied')
    expect(adapter.getDocument().timeline.tracks[0]).toEqual(captionsBeforeTrim)
  })
})
