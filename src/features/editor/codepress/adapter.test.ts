// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import {
  CodePressCommandAdapter,
  FrameTimingError,
  assertFrameAligned,
  controlledDocumentToFreeCutDocument,
  createCodePressCommandAdapter,
  freeCutDocumentToControlledDocument,
  framesToMicroseconds,
  isFrameAligned,
  isVideoCommandError,
  translateCommandBatchToFrames,
  translateCommandToFrames,
  validateCommandBatch,
  validateTimelineState,
} from './index'
import type {
  ClipItem,
  EditCommandBatch,
  MediaReference,
  TextItem,
  TimelineState,
} from './contract'
import type { ControlledEditorDocument } from './interfaces'
import type { FrameRateLike } from './timing'

function readFixture<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), 'utf8'),
  ) as T
}

interface ValidFixture {
  timeline: TimelineState
  request: EditCommandBatch
  expect: { request_valid: boolean; command_types: string[]; command_count: number }
}

const videoMedia: MediaReference = {
  media_id: 'media-video',
  media_kind: 'video',
  content_hash: 'sha256:video-v1',
  duration_us: 30_000_000,
  availability: { mode: 'cloud', cloud: { object_id: 'object-video' } },
}

const audioMedia: MediaReference = {
  media_id: 'media-audio',
  media_kind: 'audio',
  content_hash: 'sha256:audio-v1',
  duration_us: 30_000_000,
  availability: { mode: 'cloud', cloud: { object_id: 'object-audio' } },
}

function clip(overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    item_type: 'clip',
    item_id: 'clip-a',
    track_id: 'track-video',
    media_id: 'media-video',
    media_kind: 'video',
    timeline_start_us: 0,
    timeline_end_us: 1_000_000,
    source_start_us: 0,
    source_end_us: 1_000_000,
    ...overrides,
  }
}

function text(overrides: Partial<TextItem> = {}): TextItem {
  return {
    item_type: 'text',
    item_id: 'text-a',
    track_id: 'track-video',
    timeline_start_us: 0,
    timeline_end_us: 1_000_000,
    text: 'Text',
    ...overrides,
  }
}

function timeline(overrides: Partial<TimelineState> = {}): TimelineState {
  return {
    contract_version: 1,
    schema_version: 1,
    timeline_id: 'timeline-test',
    revision: 0,
    duration_us: 10_000_000,
    media: [videoMedia, audioMedia],
    tracks: [
      {
        track_id: 'track-video',
        kind: 'video',
        name: 'Video',
        locked: false,
        muted: false,
        items: [clip()],
      },
      {
        track_id: 'track-captions',
        kind: 'caption',
        name: 'Captions',
        language: 'en',
        locked: false,
        muted: false,
        items: [],
      },
    ],
    ...overrides,
  }
}

function documentFor(next: TimelineState, fps: FrameRateLike = 30): ControlledEditorDocument {
  return { timeline: next, fps, width: 1920, height: 1080 }
}

function applyRequest(adapter: CodePressCommandAdapter, request: EditCommandBatch) {
  const result = adapter.apply(request)
  expect(result.status).toBe('applied')
  if (result.status !== 'applied') throw new Error('request was not applied')
  return result
}

describe('PR1 conformance fixtures', () => {
  it.each(['valid/core-edit-batch.json', 'valid/caption-batch.json'])('accepts %s', (path) => {
    const fixture = readFixture<ValidFixture>(path)
    const timelineResult = validateTimelineState(fixture.timeline)
    const requestResult = validateCommandBatch(fixture.request)
    expect(timelineResult.ok).toBe(true)
    expect(requestResult.ok).toBe(true)
    if (!requestResult.ok) return
    expect(requestResult.value.commands.map((command) => command.type)).toEqual(
      fixture.expect.command_types,
    )
    expect(requestResult.value.commands).toHaveLength(fixture.expect.command_count)
  })

  it('rejects the canonical invalid caption-cue fixture', () => {
    const fixture = readFixture<{ request: EditCommandBatch; expect: { error_codes: string[] } }>(
      'invalid/invalid-caption-cue.json',
    )
    const result = validateCommandBatch(fixture.request)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((entry) => entry.code)).toEqual(fixture.expect.error_codes)
    expect(result.errors[0]?.details).toMatchObject({
      kind: 'invalid_request',
      path: 'commands[0].cues[0]',
    })
  })

  it('rejects a non-boolean ripple move intent', () => {
    const fixture = readFixture<ValidFixture>('valid/core-edit-batch.json')
    const request = structuredClone(fixture.request) as unknown as Record<string, unknown>
    request.commands = [
      {
        command_id: 'invalid-ripple-move',
        type: 'move_item',
        item_id: 'clip-a',
        to_track_id: 'track-video',
        timeline_start_us: 1_000_000,
        index: 0,
        ripple: 'true',
      },
    ]

    expect(validateCommandBatch(request).ok).toBe(false)
  })

  it.each(['errors/revision-conflict.json', 'errors/idempotency-conflict.json'])(
    'keeps the canonical structured error shape for %s',
    (path) => {
      const fixture = readFixture<{
        error: unknown
        expect: { code: string; retryable: boolean }
      }>(path)
      expect(isVideoCommandError(fixture.error)).toBe(true)
      expect(fixture.error).toMatchObject({
        code: fixture.expect.code,
        retryable: fixture.expect.retryable,
        details: { kind: fixture.expect.code },
      })
    },
  )
})

describe('deterministic microsecond/frame conversion', () => {
  it('uses exact integer arithmetic for frame-aligned timestamps', () => {
    expect(assertFrameAligned(1_000_000, 30)).toBe(30)
    expect(framesToMicroseconds(30, 30)).toBe(1_000_000)
    const ntsc = { numerator: 30_000n, denominator: 1_001n, value: 30_000 / 1_001 }
    expect(framesToMicroseconds(30, ntsc)).toBe(1_001_000)
    expect(assertFrameAligned(1_001_000, ntsc)).toBe(30)
    expect(isFrameAligned(33_334, 30)).toBe(false)
    expect(() => assertFrameAligned(33_334, 30)).toThrow(FrameTimingError)
  })

  it('keeps ripple-moved touching clips frame-aligned across rounded endpoints', () => {
    const frame = (value: number) => framesToMicroseconds(value, 30)
    const items = [
      clip({
        item_id: 'clip-one',
        timeline_start_us: frame(10),
        timeline_end_us: frame(50),
      }),
      clip({
        item_id: 'clip-two',
        timeline_start_us: frame(50),
        timeline_end_us: frame(90),
      }),
      clip({
        item_id: 'clip-three',
        timeline_start_us: frame(90),
        timeline_end_us: frame(130),
      }),
    ]
    const adapter = new CodePressCommandAdapter({
      document: documentFor(
        timeline({
          duration_us: frame(180),
          tracks: [
            {
              track_id: 'track-video',
              kind: 'video',
              name: 'Video',
              locked: false,
              muted: false,
              items,
            },
          ],
        }),
      ),
    })

    const result = applyRequest(adapter, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'frame-aligned-ripple-move',
      idempotency_key: 'frame-aligned-ripple-move:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'move-attached-chain',
          type: 'move_item',
          item_id: 'clip-one',
          to_track_id: 'track-video',
          timeline_start_us: frame(26),
          index: 0,
          ripple: true,
        },
      ],
    })

    expect(result.timeline.tracks[0]?.items).toMatchObject([
      { item_id: 'clip-one', timeline_start_us: frame(26), timeline_end_us: frame(66) },
      { item_id: 'clip-two', timeline_start_us: frame(66), timeline_end_us: frame(106) },
      { item_id: 'clip-three', timeline_start_us: frame(106), timeline_end_us: frame(146) },
    ])
    expect(validateTimelineState(result.timeline).ok).toBe(true)
  })

  it('translates every public timestamp in a batch before application', () => {
    const fixture = readFixture<ValidFixture>('valid/core-edit-batch.json')
    const translated = translateCommandBatchToFrames(fixture.request, 30)
    const ripple = translated.commands.find((command) => command.type === 'ripple_delete')
    expect(ripple).toMatchObject({ start_frame: 60, end_frame: 75 })
    const split = translated.commands[0]
    expect(split).toMatchObject({ at_timeline_frame: 120, at_source_frame: 120 })
  })

  it('constructs frame-native items and patches without legacy microsecond fields', () => {
    const translatedClip = translateCommandToFrames(
      {
        command_id: 'add-clip',
        type: 'add_clip',
        track_id: 'track-video',
        item: clip({
          fade_in_us: 1_000_000,
          fade_out_us: 1_000_000,
          transition_in: { transition_type: 'crossfade', duration_us: 1_000_000 },
          transition_out: { transition_type: 'dip_to_black', duration_us: 1_000_000 },
          keyframes: [
            {
              property: 'opacity',
              time_us: 0,
              value: 1,
              interpolation: 'linear',
            },
          ],
        }),
      },
      30,
    )
    if (translatedClip.type !== 'add_clip') throw new Error('clip command did not translate')
    expect(translatedClip.item).toMatchObject({
      timeline_start_frame: 0,
      timeline_end_frame: 30,
      source_start_frame: 0,
      source_end_frame: 30,
      fade_in_frame: 30,
      fade_out_frame: 30,
      transition_in: { duration_frame: 30 },
      transition_out: { duration_frame: 30 },
      keyframes: [{ time_frame: 0 }],
    })
    for (const field of [
      'timeline_start_us',
      'timeline_end_us',
      'source_start_us',
      'source_end_us',
      'fade_in_us',
      'fade_out_us',
    ]) {
      expect(translatedClip.item).not.toHaveProperty(field)
    }

    const translatedText = translateCommandToFrames(
      {
        command_id: 'add-text',
        type: 'add_text',
        track_id: 'track-video',
        item: text({
          keyframes: [
            {
              property: 'opacity',
              time_us: 0,
              value: 1,
              interpolation: 'linear',
            },
          ],
        }),
      },
      30,
    )
    if (translatedText.type !== 'add_text') throw new Error('text command did not translate')
    expect(translatedText.item).toMatchObject({
      timeline_start_frame: 0,
      timeline_end_frame: 30,
      keyframes: [{ time_frame: 0 }],
    })
    expect(translatedText.item).not.toHaveProperty('timeline_start_us')
    expect(translatedText.item).not.toHaveProperty('timeline_end_us')

    const translatedCue = translateCommandToFrames(
      {
        command_id: 'upsert-cue',
        type: 'upsert_caption_cues',
        track_id: 'track-captions',
        cues: [
          {
            item_type: 'caption_cue',
            cue_id: 'cue-frame-native',
            track_id: 'track-captions',
            start_us: 0,
            end_us: 1_000_000,
            text: 'Cue',
          },
        ],
      },
      30,
    )
    if (translatedCue.type !== 'upsert_caption_cues')
      throw new Error('caption command did not translate')
    expect(translatedCue.cues[0]).toMatchObject({ start_frame: 0, end_frame: 30 })
    expect(translatedCue.cues[0]).not.toHaveProperty('start_us')
    expect(translatedCue.cues[0]).not.toHaveProperty('end_us')

    const translatedProperties = translateCommandToFrames(
      {
        command_id: 'set-properties',
        type: 'set_item_properties',
        item_id: 'clip-a',
        properties: {
          fade_in_us: 1_000_000,
          fade_out_us: null,
          transition_in: { transition_type: 'crossfade', duration_us: 1_000_000 },
          transition_out: null,
          keyframes: [
            {
              property: 'opacity',
              time_us: 0,
              value: 1,
              interpolation: 'linear',
            },
          ],
        },
      },
      30,
    )
    if (translatedProperties.type !== 'set_item_properties')
      throw new Error('properties command did not translate')
    expect(translatedProperties.properties).toMatchObject({
      fade_in_frame: 30,
      fade_out_frame: null,
      transition_in: { duration_frame: 30 },
      transition_out: null,
      keyframes: [{ time_frame: 0 }],
    })
    for (const field of ['fade_in_us', 'fade_out_us']) {
      expect(translatedProperties.properties).not.toHaveProperty(field)
    }
  })
})

describe('controlled command adapter', () => {
  it('round-trips a frame-native FreeCut document through the typed boundary', () => {
    const frameDocument = {
      timelineId: 'timeline-frame',
      revision: 4,
      fps: 30,
      durationInFrames: 180,
      media: [videoMedia],
      tracks: [
        {
          id: 'track-video',
          kind: 'video' as const,
          name: 'Video',
          locked: false,
          muted: false,
          items: [
            {
              type: 'video' as const,
              id: 'clip-frame',
              trackId: 'track-video',
              mediaId: 'media-video',
              from: 30,
              durationInFrames: 60,
              sourceStart: 0,
              sourceEnd: 60,
            },
          ],
        },
      ],
      width: 1920,
      height: 1080,
    }
    const controlled = freeCutDocumentToControlledDocument(frameDocument)
    expect(controlled.timeline.tracks[0]?.items[0]).toMatchObject({
      item_id: 'clip-frame',
      timeline_start_us: 1_000_000,
      timeline_end_us: 3_000_000,
    })
    const roundTrip = controlledDocumentToFreeCutDocument(controlled)
    expect(roundTrip).toMatchObject({
      timelineId: 'timeline-frame',
      revision: 4,
      durationInFrames: 180,
      fps: 30,
    })
    expect(roundTrip.tracks[0]?.items[0]).toMatchObject({
      id: 'clip-frame',
      from: 30,
      durationInFrames: 60,
    })
  })

  it('puts a clip that states no source range at the start of its media on the wire', () => {
    const frameDocument = {
      timelineId: 'timeline-bare-source',
      revision: 1,
      fps: 30,
      durationInFrames: 180,
      media: [videoMedia],
      tracks: [
        {
          id: 'track-video',
          kind: 'video' as const,
          name: 'Video',
          locked: false,
          muted: false,
          items: [
            {
              type: 'video' as const,
              id: 'clip-bare-source',
              trackId: 'track-video',
              mediaId: 'media-video',
              from: 30,
              durationInFrames: 60,
            },
          ],
        },
      ],
      width: 1920,
      height: 1080,
    }

    // The wire shape requires a concrete window; the timeline position is not
    // it.  A bound taken from `from` would be 1_000_000..3_000_000 here, and
    // would follow the clip on every move.
    expect(
      freeCutDocumentToControlledDocument(frameDocument).timeline.tracks[0]?.items[0],
    ).toMatchObject({
      item_id: 'clip-bare-source',
      timeline_start_us: 1_000_000,
      source_start_us: 0,
      source_end_us: 2_000_000,
    })
  })

  it('round-trips nonzero-start clip, text, and caption endpoints at fractional FPS', () => {
    const rates: readonly FrameRateLike[] = [
      29.97,
      { numerator: 30_000n, denominator: 1_001n, value: 30_000 / 1_001 },
    ]
    for (const fps of rates) {
      const frameDocument = {
        timelineId: 'timeline-fractional',
        revision: 2,
        fps,
        durationInFrames: 180,
        media: [videoMedia],
        tracks: [
          {
            id: 'track-video',
            kind: 'video' as const,
            name: 'Video',
            locked: false,
            muted: false,
            items: [
              {
                type: 'video' as const,
                id: 'clip-fractional',
                trackId: 'track-video',
                mediaId: 'media-video',
                from: 1,
                durationInFrames: 1,
                sourceStart: 2,
                sourceEnd: 3,
              },
            ],
          },
          {
            id: 'track-overlay',
            kind: 'overlay' as const,
            name: 'Overlay',
            locked: false,
            muted: false,
            items: [
              {
                type: 'text' as const,
                id: 'text-fractional',
                trackId: 'track-overlay',
                from: 2,
                durationInFrames: 1,
                text: 'Fractional text',
              },
            ],
          },
          {
            id: 'track-captions',
            kind: 'caption' as const,
            name: 'Captions',
            language: 'en',
            locked: false,
            muted: false,
            items: [
              {
                type: 'caption_cue' as const,
                id: 'cue-fractional',
                trackId: 'track-captions',
                from: 3,
                durationInFrames: 1,
                text: 'Fractional cue',
              },
            ],
          },
        ],
        width: 1920,
        height: 1080,
      }
      const controlled = freeCutDocumentToControlledDocument(frameDocument)
      const clipItem = controlled.timeline.tracks[0]?.items[0]
      const textItem = controlled.timeline.tracks[1]?.items[0]
      const cueItem = controlled.timeline.tracks[2]?.items[0]
      expect(clipItem).toMatchObject({
        timeline_start_us: framesToMicroseconds(1, fps),
        timeline_end_us: framesToMicroseconds(2, fps),
        source_start_us: framesToMicroseconds(2, fps),
        source_end_us: framesToMicroseconds(3, fps),
      })
      expect(textItem).toMatchObject({
        timeline_start_us: framesToMicroseconds(2, fps),
        timeline_end_us: framesToMicroseconds(3, fps),
      })
      expect(cueItem).toMatchObject({
        start_us: framesToMicroseconds(3, fps),
        end_us: framesToMicroseconds(4, fps),
      })

      const roundTrip = controlledDocumentToFreeCutDocument(controlled)
      expect(roundTrip.tracks[0]?.items[0]).toMatchObject({ from: 1, durationInFrames: 1 })
      expect(roundTrip.tracks[1]?.items[0]).toMatchObject({ from: 2, durationInFrames: 1 })
      expect(roundTrip.tracks[2]?.items[0]).toMatchObject({ from: 3, durationInFrames: 1 })
    }
  })

  it('applies the canonical core fixture atomically and reports normalized effects', () => {
    const fixture = readFixture<ValidFixture>('valid/core-edit-batch.json')
    const adapter = new CodePressCommandAdapter({ document: documentFor(fixture.timeline) })
    const result = applyRequest(adapter, fixture.request)
    expect(result.previous_revision).toBe(7)
    expect(result.resulting_revision).toBe(8)
    expect(result.timeline.duration_us).toBe(11_500_000)
    expect(result.commands.map((command) => command.command_type)).toEqual(
      fixture.expect.command_types,
    )
    expect(result.commands[2]?.effect.timeline_delta_us).toBe(-500_000)
    expect(adapter.getSnapshot().revision).toBe(8)
  })

  it('applies caption cues, preserves cue order, and supports cue styles', () => {
    const fixture = readFixture<ValidFixture>('valid/caption-batch.json')
    const adapter = new CodePressCommandAdapter({ document: documentFor(fixture.timeline) })
    const result = applyRequest(adapter, fixture.request)
    const captionTrack = result.timeline.tracks.find((track) => track.track_id === 'track-captions')
    expect(
      captionTrack?.items.map((item) =>
        item.item_type === 'caption_cue' ? item.cue_id : item.item_id,
      ),
    ).toEqual(['cue-hello', 'cue-next'])

    const styled = applyRequest(adapter, {
      contract_version: 1,
      timeline_id: 'timeline-caption',
      operation_id: 'operation-captions-style',
      idempotency_key: 'timeline-caption:style:1',
      base_revision: 3,
      preconditions: [{ type: 'item_exists', item_id: 'cue-hello' }],
      commands: [
        {
          command_id: 'command-style',
          type: 'set_caption_style',
          track_id: 'track-captions',
          cue_ids: ['cue-hello'],
          style: { color: '#00ff00', alignment: 'center' },
        },
      ],
    })
    const styledCue = styled.timeline.tracks[0]?.items[0]
    expect(styledCue).toMatchObject({
      cue_id: 'cue-hello',
      style: { color: '#00ff00', alignment: 'center' },
    })
  })

  it('ripple-deletes deterministically across tracks and leaves selected tracks isolated', () => {
    const base = timeline({
      tracks: [
        {
          track_id: 'track-video',
          kind: 'video',
          name: 'Video',
          locked: false,
          muted: false,
          items: [
            clip({
              item_id: 'before',
              timeline_start_us: 0,
              timeline_end_us: 1_000_000,
              source_end_us: 1_000_000,
            }),
            clip({
              item_id: 'after',
              timeline_start_us: 3_000_000,
              timeline_end_us: 4_000_000,
              source_start_us: 3_000_000,
              source_end_us: 4_000_000,
            }),
          ],
        },
        {
          track_id: 'track-captions',
          kind: 'caption',
          name: 'Captions',
          language: 'en',
          locked: false,
          muted: false,
          items: [
            {
              item_type: 'caption_cue',
              cue_id: 'cue-after',
              track_id: 'track-captions',
              start_us: 3_000_000,
              end_us: 4_000_000,
              text: 'After',
            },
          ],
        },
      ],
    })
    const adapter = new CodePressCommandAdapter({ document: documentFor(base) })
    const allTracks = applyRequest(adapter, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'ripple-all',
      idempotency_key: 'ripple-all:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'ripple',
          type: 'ripple_delete',
          start_us: 1_000_000,
          end_us: 2_000_000,
          track_ids: null,
        },
      ],
    })
    const videoAfter = allTracks.timeline.tracks[0]?.items.find(
      (item) => itemIdForTest(item) === 'after',
    )
    const captionAfter = allTracks.timeline.tracks[1]?.items.find(
      (item) => itemIdForTest(item) === 'cue-after',
    )
    expect(videoAfter).toMatchObject({ timeline_start_us: 2_000_000, timeline_end_us: 3_000_000 })
    expect(captionAfter).toMatchObject({ start_us: 2_000_000, end_us: 3_000_000 })
    expect(allTracks.timeline.duration_us).toBe(9_000_000)

    const isolated = new CodePressCommandAdapter({ document: documentFor(base) })
    const selected = applyRequest(isolated, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'ripple-video',
      idempotency_key: 'ripple-video:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'ripple-video',
          type: 'ripple_delete',
          start_us: 1_000_000,
          end_us: 2_000_000,
          track_ids: ['track-video'],
        },
      ],
    })
    expect(selected.timeline.tracks[1]?.items[0]).toMatchObject({
      start_us: 3_000_000,
      end_us: 4_000_000,
    })
    expect(selected.timeline.duration_us).toBe(10_000_000)
  })

  it('re-encodes NTSC ripple endpoints independently at fractional FPS', () => {
    const fps: FrameRateLike = {
      numerator: 30_000n,
      denominator: 1_001n,
      value: 30_000 / 1_001,
    }
    const frame = (value: number) => framesToMicroseconds(value, fps)
    const base = timeline({
      duration_us: frame(12),
      tracks: [
        {
          track_id: 'track-video',
          kind: 'video',
          name: 'Video',
          locked: false,
          muted: false,
          items: [
            clip({
              item_id: 'before-ntsc',
              timeline_start_us: frame(0),
              timeline_end_us: frame(1),
              source_start_us: frame(0),
              source_end_us: frame(1),
            }),
            clip({
              item_id: 'after-ntsc',
              timeline_start_us: frame(2),
              timeline_end_us: frame(3),
              source_start_us: frame(2),
              source_end_us: frame(3),
            }),
          ],
        },
        {
          track_id: 'track-captions',
          kind: 'caption',
          name: 'Captions',
          language: 'en',
          locked: false,
          muted: false,
          items: [
            {
              item_type: 'caption_cue',
              cue_id: 'cue-after-ntsc',
              track_id: 'track-captions',
              start_us: frame(2),
              end_us: frame(3),
              text: 'After NTSC',
            },
          ],
        },
      ],
    })
    const adapter = new CodePressCommandAdapter({ document: documentFor(base, fps) })
    const result = applyRequest(adapter, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'ripple-ntsc',
      idempotency_key: 'ripple-ntsc:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'ripple-ntsc-command',
          type: 'ripple_delete',
          start_us: frame(1),
          end_us: frame(2),
          track_ids: null,
        },
      ],
    })
    const videoAfter = result.timeline.tracks[0]?.items.find(
      (item) => itemIdForTest(item) === 'after-ntsc',
    )
    const captionAfter = result.timeline.tracks[1]?.items.find(
      (item) => itemIdForTest(item) === 'cue-after-ntsc',
    )
    expect(videoAfter).toMatchObject({
      timeline_start_us: frame(1),
      timeline_end_us: frame(2),
    })
    expect(captionAfter).toMatchObject({ start_us: frame(1), end_us: frame(2) })
    expect(result.timeline.duration_us).toBe(frame(11))
    expect(validateTimelineState(result.timeline).ok).toBe(true)

    const next = adapter.apply({
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'move-after-ntsc',
      idempotency_key: 'move-after-ntsc:1',
      base_revision: 1,
      preconditions: [],
      commands: [
        {
          command_id: 'move-after-ntsc-command',
          type: 'move_item',
          item_id: 'after-ntsc',
          to_track_id: 'track-video',
          timeline_start_us: frame(1),
          index: 1,
        },
      ],
    })
    expect(next.status).toBe('applied')
  })

  it('keeps the left fragment ID and derives a stable right fragment for a crossing item', () => {
    const crossing = new CodePressCommandAdapter({
      document: documentFor(
        timeline({
          duration_us: 8_000_000,
          tracks: [
            {
              track_id: 'track-video',
              kind: 'video',
              name: 'Video',
              locked: false,
              muted: false,
              items: [
                clip({
                  item_id: 'crossing',
                  timeline_start_us: 0,
                  timeline_end_us: 4_000_000,
                  source_start_us: 0,
                  source_end_us: 4_000_000,
                }),
              ],
            },
            {
              track_id: 'track-captions',
              kind: 'caption',
              name: 'Captions',
              language: 'en',
              locked: false,
              muted: false,
              items: [],
            },
          ],
        }),
      ),
    })
    const result = applyRequest(crossing, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'ripple-crossing',
      idempotency_key: 'ripple-crossing:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'ripple-crossing-command',
          type: 'ripple_delete',
          start_us: 1_000_000,
          end_us: 2_000_000,
          track_ids: ['track-video'],
        },
      ],
    })
    const items = result.timeline.tracks[0]?.items
    expect(items?.map(itemIdForTest)).toEqual(['crossing', 'crossing:ripple-right'])
    expect(items?.[0]).toMatchObject({
      timeline_start_us: 0,
      timeline_end_us: 1_000_000,
      source_end_us: 1_000_000,
    })
    expect(items?.[1]).toMatchObject({
      timeline_start_us: 1_000_000,
      timeline_end_us: 3_000_000,
      source_start_us: 2_000_000,
      source_end_us: 4_000_000,
    })
  })

  it('allocates bounded ripple fragment IDs for max-length IDs and collisions', () => {
    const maxId = 'x'.repeat(128)
    const baseFragmentId = `${maxId.slice(0, 128 - ':ripple-right'.length)}:ripple-right`
    const suffixFragmentId = `${maxId.slice(0, 128 - ':ripple-2'.length)}:ripple-2`
    const base = timeline({
      duration_us: 8_000_000,
      tracks: [
        {
          track_id: 'track-video',
          kind: 'video',
          name: 'Video',
          locked: false,
          muted: false,
          items: [
            clip({
              item_id: maxId,
              timeline_start_us: 0,
              timeline_end_us: 4_000_000,
              source_start_us: 0,
              source_end_us: 4_000_000,
            }),
            clip({
              item_id: baseFragmentId,
              timeline_start_us: 5_000_000,
              timeline_end_us: 6_000_000,
              source_start_us: 5_000_000,
              source_end_us: 6_000_000,
            }),
          ],
        },
        {
          track_id: 'track-captions',
          kind: 'caption',
          name: 'Captions',
          language: 'en',
          locked: false,
          muted: false,
          items: [],
        },
      ],
    })
    const adapter = new CodePressCommandAdapter({ document: documentFor(base) })
    const result = applyRequest(adapter, {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'ripple-max-id',
      idempotency_key: 'ripple-max-id:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'ripple-max-id-command',
          type: 'ripple_delete',
          start_us: 1_000_000,
          end_us: 2_000_000,
          track_ids: ['track-video'],
        },
      ],
    })
    const ids = result.timeline.tracks[0]?.items.map(itemIdForTest)
    expect(ids).toEqual([maxId, suffixFragmentId, baseFragmentId])
    expect(ids?.every((id) => id.length <= 128)).toBe(true)
    expect(validateTimelineState(result.timeline).ok).toBe(true)
  })

  it('does not mutate the controlled document when a later command fails', () => {
    const adapter = new CodePressCommandAdapter({ document: documentFor(timeline()) })
    const result = adapter.apply({
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'atomic-failure',
      idempotency_key: 'atomic-failure:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        { command_id: 'remove-ghost', type: 'remove_item', item_id: 'ghost' },
        {
          command_id: 'add-text',
          type: 'add_text',
          track_id: 'track-video',
          item: text({ item_id: 'would-not-land' }),
        },
      ],
    })
    expect(result.status).toBe('rejected')
    expect(adapter.getSnapshot().revision).toBe(0)
    expect(adapter.getSnapshot().document.timeline.tracks[0]?.items).toHaveLength(1)
  })

  it('commits before editor, subscriber, and synchronous telemetry failures', () => {
    const initial = documentFor(timeline())
    const editor = {
      getDocument: () => initial,
      replaceDocument: () => {
        throw new Error('editor observer failed')
      },
    }
    const adapter = new CodePressCommandAdapter({
      document: initial,
      editor,
      hosts: {
        telemetryClient: {
          emit: () => {
            throw new Error('telemetry observer failed')
          },
        },
      },
    })
    let subscriberCalls = 0
    adapter.subscribe(() => {
      subscriberCalls += 1
      throw new Error('subscriber observer failed')
    })
    adapter.subscribe(() => {
      subscriberCalls += 1
    })
    const request: EditCommandBatch = {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'observer-failures',
      idempotency_key: 'observer-failures:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'move-observer-failures',
          type: 'move_item',
          item_id: 'clip-a',
          to_track_id: 'track-video',
          timeline_start_us: 1_000_000,
          index: 0,
        },
      ],
    }
    const result = adapter.apply(request)
    expect(result.status).toBe('applied')
    expect(adapter.getSnapshot().revision).toBe(1)
    expect(subscriberCalls).toBe(2)
    const replayed = adapter.apply(request)
    expect(replayed.status).toBe('replayed')
  })

  it('handles rejected telemetry without changing the committed result', async () => {
    let unhandled: unknown
    const onUnhandled = (reason: unknown) => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const adapter = new CodePressCommandAdapter({
        document: documentFor(timeline()),
        hosts: {
          telemetryClient: {
            emit: () => Promise.reject(new Error('async telemetry failed')),
          },
        },
      })
      const result = adapter.apply({
        contract_version: 1,
        timeline_id: 'timeline-test',
        operation_id: 'async-telemetry-failure',
        idempotency_key: 'async-telemetry-failure:1',
        base_revision: 0,
        preconditions: [],
        commands: [
          {
            command_id: 'move-async-telemetry',
            type: 'move_item',
            item_id: 'clip-a',
            to_track_id: 'track-video',
            timeline_start_us: 1_000_000,
            index: 0,
          },
        ],
      })
      expect(result.status).toBe('applied')
      expect(adapter.getSnapshot().revision).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('rejects request_job until a host dispatch boundary is implemented', () => {
    let hostCalls = 0
    const adapter = new CodePressCommandAdapter({
      document: documentFor(timeline()),
      hosts: {
        mediaJobClient: {
          request: () => {
            hostCalls += 1
            return { job_id: 'job-should-not-run' }
          },
        },
      },
    })
    const result = adapter.apply({
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'request-job',
      idempotency_key: 'request-job:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'request-job-command',
          type: 'request_job',
          job_type: 'thumbnail',
          media_id: 'media-video',
        },
      ],
    })
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'unsupported_command', retryable: false },
    })
    expect(hostCalls).toBe(0)
    expect(adapter.getSnapshot().revision).toBe(0)
  })

  it('returns explicit revision and idempotency conflicts', () => {
    const adapter = createCodePressCommandAdapter({ document: documentFor(timeline()) })
    const request: EditCommandBatch = {
      contract_version: 1,
      timeline_id: 'timeline-test',
      operation_id: 'move-once',
      idempotency_key: 'move:1',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'move',
          type: 'move_item',
          item_id: 'clip-a',
          to_track_id: 'track-video',
          timeline_start_us: 1_000_000,
          index: 0,
        },
      ],
    }
    const applied = applyRequest(adapter, request)
    const replayed = adapter.apply(request)
    expect(replayed.status).toBe('replayed')
    if (replayed.status === 'replayed')
      expect(replayed.replayed_operation_id).toBe(applied.operation_id)

    const idempotencyConflict = adapter.apply({
      ...request,
      operation_id: 'different-operation',
      commands: [{ ...request.commands[0]!, command_id: 'different-command' }],
    })
    expect(idempotencyConflict).toMatchObject({
      status: 'rejected',
      error: { code: 'idempotency_conflict', retryable: false },
    })

    const stale = adapter.apply({ ...request, operation_id: 'stale', idempotency_key: 'stale:1' })
    expect(stale).toMatchObject({
      status: 'rejected',
      error: {
        code: 'revision_conflict',
        retryable: true,
        details: { rebase: { automatic: false, retry_with_revision: 1 } },
      },
    })
  })

  it('keeps render and media state outside the command/document contract', async () => {
    const renderer = {
      renderFrame: (request: {
        frame: number
        time_us: number
        width: number
        height: number
        document: ControlledEditorDocument
      }) => ({
        frame: request.frame,
        time_us: request.time_us,
        width: request.width,
        height: request.height,
        payload: { source: 'renderer-only' },
      }),
    }
    const adapter = new CodePressCommandAdapter({ document: documentFor(timeline()), renderer })
    await expect(adapter.renderFrame(1_000_000)).resolves.toMatchObject({
      frame: 30,
      time_us: 1_000_000,
      payload: { source: 'renderer-only' },
    })
    await expect(adapter.renderFrame(33_334)).rejects.toThrow(FrameTimingError)
    expect(JSON.stringify(adapter.getSnapshot().document.timeline)).not.toContain('/Users/')
    expect(JSON.stringify(adapter.getSnapshot().document.timeline)).not.toContain('file://')
  })
})

function itemIdForTest(item: TimelineState['tracks'][number]['items'][number]): string {
  return item.item_type === 'caption_cue' ? item.cue_id : item.item_id
}
