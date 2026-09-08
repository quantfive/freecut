import { describe, expect, it, vi } from 'vite-plus/test'
import type { FreeCutFrameClip, FreeCutFrameDocument } from '../codepress/document'
import type { EditorTranscriptPort, HostTranscriptSection } from './contract'
import {
  captionRangesForEdit,
  assertCaptionTargetAvailable,
  loadCaptionSections,
  validateCaptionPreview,
} from './caption-generation'

const section: HostTranscriptSection = {
  id: 's',
  transcriptId: 't',
  ordinal: 0,
  startUs: 0,
  endUs: 3_000_000,
  text: 'hello um world',
  timingSource: 'provider',
  words: [
    { text: 'hello', startUs: 0, endUs: 1_000_000 },
    { text: 'um', startUs: 1_000_000, endUs: 2_000_000 },
    { text: 'world', startUs: 2_000_000, endUs: 3_000_000 },
  ],
}
const clip: FreeCutFrameClip = {
  type: 'video',
  id: 'a',
  trackId: 'v',
  mediaId: 'm',
  from: 0,
  durationInFrames: 30,
  sourceStart: 0,
  sourceEnd: 30,
}
const document: FreeCutFrameDocument = {
  timelineId: 'timeline',
  revision: 4,
  fps: 30,
  width: 1280,
  height: 720,
  durationInFrames: 150,
  media: [],
  tracks: [
    {
      id: 'v',
      kind: 'video',
      name: 'Video',
      locked: false,
      muted: false,
      items: [
        clip,
        { ...clip, id: 'after-cut', from: 30, sourceStart: 60, sourceEnd: 90 },
        { ...clip, id: 'repeat', from: 60, durationInFrames: 90, sourceEnd: 90 },
      ],
    },
  ],
}

describe('captions from the edited sequence', () => {
  it('excludes removed words while retaining an untouched repeated occurrence', () => {
    expect(captionRangesForEdit(document, 'm', [section])).toEqual([
      { itemId: 'a', startUs: 0, endUs: 1_000_000, text: 'hello' },
      { itemId: 'after-cut', startUs: 2_000_000, endUs: 3_000_000, text: 'world' },
      { itemId: 'repeat', startUs: 0, endUs: 3_000_000, text: 'hello um world' },
    ])
    expect(captionRangesForEdit(document, 'm', [section], new Set(['after-cut']))).toEqual([
      { itemId: 'after-cut', startUs: 2_000_000, endUs: 3_000_000, text: 'world' },
    ])
  })
  it('clamps measured word boundaries to trimmed source handles for caption containment', () => {
    const trimmed = {
      ...document,
      tracks: [
        { ...document.tracks[0]!, items: [{ ...clip, sourceStart: 15, sourceEnd: 75, speed: 2 }] },
      ],
    }
    expect(captionRangesForEdit(trimmed, 'm', [section])).toEqual([
      { itemId: 'a', startUs: 500_000, endUs: 2_500_000, text: 'hello um world' },
    ])
  })
  it('fails honestly without real timing or selected clips', () => {
    expect(() =>
      captionRangesForEdit(document, 'm', [{ ...section, timingSource: 'synthetic' }]),
    ).toThrow('No timed transcript')
    expect(() => captionRangesForEdit(document, 'm', [section], new Set())).toThrow(
      'No timed transcript',
    )
  })
  it('loads all pages and rejects a repeated cursor instead of silently captioning a partial edit', async () => {
    const getSections = vi
      .fn()
      .mockResolvedValueOnce({
        transcriptId: 't',
        sections: [section],
        hasMore: true,
        nextCursor: 'next',
      })
      .mockResolvedValue({ transcriptId: 't', sections: [], hasMore: true, nextCursor: 'next' })
    await expect(
      loadCaptionSections({ getSections } as unknown as EditorTranscriptPort, 't'),
    ).rejects.toThrow('completely')
  })
  it('rejects a footage-changing command masquerading as captions', () => {
    expect(() =>
      validateCaptionPreview(
        { commandBatch: { commands: [{ type: 'ripple_delete' }] } } as never,
        {} as never,
        'timeline',
      ),
    ).toThrow()
  })
  it('rejects an existing generated caption track hidden below video or locked', () => {
    const track = {
      id: 'host-transcript-captions',
      name: 'Transcript captions',
      kind: 'caption' as const,
      locked: false,
      muted: false,
      items: [],
    }
    expect(() =>
      assertCaptionTargetAvailable({ ...document, tracks: [...document.tracks, track] }, true),
    ).toThrow('below video')
    expect(() =>
      assertCaptionTargetAvailable({ ...document, tracks: [{ ...track, locked: true }] }, true),
    ).toThrow('locked')
    expect(() => assertCaptionTargetAvailable({ ...document, tracks: [track] }, false)).toThrow(
      'Replace all cues',
    )
  })
})
