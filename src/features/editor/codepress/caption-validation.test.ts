import { describe, expect, it } from 'vite-plus/test'

import {
  MAX_CAPTION_CUES_PER_COMMAND,
  validateCommandBatch,
  validateTimelineState,
} from './contract'
import { validateFrameCaptionCue, validateFrameCaptionCues } from './caption-validation'
import type { CaptionFrameCue } from './caption-validation'

function cue(id: string, start: number, end: number, text = id): CaptionFrameCue {
  return {
    type: 'caption_cue',
    id,
    trackId: 'captions-en',
    from: start,
    durationInFrames: end - start,
    text,
  }
}

function timelineWith(cues: Array<{ id: string; start: number; end: number }>) {
  return {
    contract_version: 1 as const,
    schema_version: 1 as const,
    timeline_id: 'timeline-captions',
    revision: 0,
    duration_us: 10_000_000,
    media: [],
    tracks: [
      {
        track_id: 'captions-en',
        kind: 'caption' as const,
        name: 'English',
        language: 'en',
        locked: false,
        muted: false,
        items: cues.map(({ id, start, end }) => ({
          item_type: 'caption_cue' as const,
          cue_id: id,
          track_id: 'captions-en',
          start_us: start,
          end_us: end,
          text: id,
        })),
      },
    ],
  }
}

describe('frame-native caption bounds', () => {
  it('rejects malformed, empty, and out-of-range cues', () => {
    expect(validateFrameCaptionCue(cue('empty', 10, 10, ' '), 60).map((item) => item.code)).toEqual(
      ['invalid_text', 'invalid_range'],
    )
    expect(validateFrameCaptionCue(cue('outside', 0, 61), 60).map((item) => item.code)).toContain(
      'out_of_bounds',
    )
  })

  it('rejects overlapping, duplicate, and over-budget cue sets', () => {
    const issues = validateFrameCaptionCues(
      [cue('one', 0, 20), cue('two', 19, 30), cue('two', 31, 40)],
      60,
    )
    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['overlap', 'invalid_id']),
    )

    const tooMany = Array.from({ length: MAX_CAPTION_CUES_PER_COMMAND + 1 }, (_, index) =>
      cue(`cue-${index}`, index * 2, index * 2 + 1),
    )
    expect(
      validateFrameCaptionCues(tooMany, tooMany.length * 2).map((item) => item.code),
    ).toContain('too_many_cues')
  })
})

describe('canonical caption validation', () => {
  it('rejects overlapping timeline cues before an adapter can mount them', () => {
    const result = validateTimelineState(
      timelineWith([
        { id: 'one', start: 0, end: 2_000_000 },
        { id: 'two', start: 1_000_000, end: 3_000_000 },
      ]),
    )
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.errors.some((error) => error.message.includes('must not overlap'))).toBe(true)
  })

  it('rejects malformed style and overlapping upsert commands', () => {
    const result = validateCommandBatch({
      contract_version: 1,
      timeline_id: 'timeline-captions',
      operation_id: 'caption-invalid',
      idempotency_key: 'caption-invalid',
      base_revision: 0,
      preconditions: [],
      commands: [
        {
          command_id: 'upsert',
          type: 'upsert_caption_cues',
          track_id: 'captions-en',
          cues: [
            {
              item_type: 'caption_cue',
              cue_id: 'one',
              track_id: 'captions-en',
              start_us: 0,
              end_us: 2_000_000,
              text: 'one',
            },
            {
              item_type: 'caption_cue',
              cue_id: 'two',
              track_id: 'captions-en',
              start_us: 1_000_000,
              end_us: 3_000_000,
              text: 'two',
            },
          ],
        },
        {
          command_id: 'style',
          type: 'set_caption_style',
          track_id: 'captions-en',
          cue_ids: null,
          style: { font_size: 0, background_opacity: 2 },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['invalid_request']),
    )
    expect(result.errors.some((error) => error.message.includes('must not overlap'))).toBe(true)
    expect(result.errors.some((error) => error.message.includes('background_opacity'))).toBe(true)
  })
})
