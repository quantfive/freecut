import { describe, expect, it } from 'vite-plus/test'

import { CodePressCommandAdapter } from './adapter'
import {
  applyCaptionCommands,
  captionCuePrecondition,
  createCaptionCommandBatch,
} from './caption-commands'
import { framesToMicroseconds, type FrameRateLike } from './timing'
import type { ControlledEditorDocument } from './interfaces'

const ntsc: FrameRateLike = {
  numerator: 30_000n,
  denominator: 1_001n,
  value: 30_000 / 1_001,
}

function documentWithCaptionTrack(): ControlledEditorDocument {
  return {
    fps: ntsc,
    width: 1920,
    height: 1080,
    timeline: {
      contract_version: 1,
      schema_version: 1,
      timeline_id: 'timeline-captions',
      revision: 0,
      duration_us: framesToMicroseconds(180, ntsc),
      media: [],
      tracks: [
        {
          track_id: 'captions-en',
          kind: 'caption',
          name: 'English',
          language: 'en',
          locked: false,
          muted: false,
          items: [],
        },
      ],
    },
  }
}

function frameCue(start: number, end: number, text = 'Hello') {
  return {
    type: 'caption_cue' as const,
    id: 'cue-1',
    trackId: 'captions-en',
    from: start,
    durationInFrames: end - start,
    text,
  }
}

describe('caption command bridge', () => {
  it('translates frame-native cue timing without leaking frame or legacy fields', () => {
    const adapter = new CodePressCommandAdapter({ document: documentWithCaptionTrack() })
    const batch = createCaptionCommandBatch(
      adapter,
      [
        {
          command_id: 'upsert-cue',
          type: 'upsert_caption_cues',
          track_id: 'captions-en',
          cues: [
            {
              item_type: 'caption_cue',
              cue_id: 'cue-1',
              track_id: 'captions-en',
              start_frame: 3,
              end_frame: 31,
              text: 'NTSC cue',
              style: { font_size: 40, alignment: 'center' },
            },
          ],
        },
      ],
      ntsc,
      { operationId: 'caption-op-1' },
    )

    const command = batch.commands[0]
    expect(command).toMatchObject({ type: 'upsert_caption_cues' })
    if (command?.type !== 'upsert_caption_cues') return
    expect(command.cues[0]).toMatchObject({
      start_us: framesToMicroseconds(3, ntsc),
      end_us: framesToMicroseconds(31, ntsc),
    })
    expect(command.cues[0]).not.toHaveProperty('start_frame')
    expect(command.cues[0]).not.toHaveProperty('end_frame')

    const result = adapter.apply(batch)
    expect(result.status).toBe('applied')
    const cue = adapter.getSnapshot().document.timeline.tracks[0]?.items[0]
    expect(cue).toMatchObject({
      item_type: 'caption_cue',
      start_us: framesToMicroseconds(3, ntsc),
      end_us: framesToMicroseconds(31, ntsc),
    })
  })

  it('applies add/update/remove track and cue commands plus styles atomically', () => {
    const adapter = new CodePressCommandAdapter({
      document: {
        ...documentWithCaptionTrack(),
        timeline: { ...documentWithCaptionTrack().timeline, tracks: [] },
      },
    })
    const addTrack = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'add-track',
          type: 'add_caption_track',
          track_id: 'captions-en',
          name: 'English',
          language: 'en',
          index: 0,
        },
      ],
      ntsc,
      { operationId: 'caption-add-track' },
    )
    expect(addTrack.status).toBe('applied')

    const cue = frameCue(10, 40)
    const addCue = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'add-cue',
          type: 'upsert_caption_cues',
          track_id: 'captions-en',
          cues: [
            {
              item_type: 'caption_cue',
              cue_id: cue.id,
              track_id: cue.trackId,
              start_frame: cue.from,
              end_frame: cue.from + cue.durationInFrames,
              text: cue.text,
            },
          ],
        },
      ],
      ntsc,
      {
        operationId: 'caption-add-cue',
        preconditions: [{ type: 'track_exists', track_id: 'captions-en' }],
      },
    )
    expect(addCue.status).toBe('applied')

    const updatedCue = { ...cue, text: 'Updated cue', from: 12, durationInFrames: 30 }
    const updateCue = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'update-cue',
          type: 'upsert_caption_cues',
          track_id: 'captions-en',
          cues: [
            {
              item_type: 'caption_cue',
              cue_id: updatedCue.id,
              track_id: updatedCue.trackId,
              start_frame: updatedCue.from,
              end_frame: updatedCue.from + updatedCue.durationInFrames,
              text: updatedCue.text,
            },
          ],
        },
      ],
      ntsc,
      {
        operationId: 'caption-update-cue',
        preconditions: [captionCuePrecondition(cue, ntsc)],
      },
    )
    expect(updateCue.status).toBe('applied')

    const style = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'style-cue',
          type: 'set_caption_style',
          track_id: 'captions-en',
          cue_ids: ['cue-1'],
          style: { font_size: 48, color: '#ff0', alignment: 'center' },
        },
      ],
      ntsc,
      {
        operationId: 'caption-style-cue',
        preconditions: [captionCuePrecondition(updatedCue, ntsc)],
      },
    )
    expect(style.status).toBe('applied')
    expect(adapter.getSnapshot().document.timeline.tracks[0]?.items[0]).toMatchObject({
      text: 'Updated cue',
      style: { font_size: 48, color: '#ff0' },
    })

    const trackStyle = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'style-track',
          type: 'set_caption_style',
          track_id: 'captions-en',
          cue_ids: null,
          style: { font_family: 'Inter', background_opacity: 0.6 },
        },
      ],
      ntsc,
      { operationId: 'caption-style-track' },
    )
    expect(trackStyle.status).toBe('applied')
    expect(adapter.getSnapshot().document.timeline.tracks[0]?.default_style).toMatchObject({
      font_family: 'Inter',
      background_opacity: 0.6,
    })

    const removedCue = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'remove-cue',
          type: 'remove_caption_cues',
          track_id: 'captions-en',
          cue_ids: ['cue-1'],
        },
      ],
      ntsc,
      { operationId: 'caption-remove-cue' },
    )
    expect(removedCue.status).toBe('applied')
    expect(adapter.getSnapshot().document.timeline.tracks[0]?.items).toHaveLength(0)

    const removedTrack = applyCaptionCommands(
      adapter,
      [
        {
          command_id: 'remove-track',
          type: 'remove_caption_track',
          track_id: 'captions-en',
        },
      ],
      ntsc,
      { operationId: 'caption-remove-track' },
    )
    expect(removedTrack.status).toBe('applied')
    expect(adapter.getSnapshot().document.timeline.tracks).toHaveLength(0)
  })

  it('preserves idempotency replay and reports revision/idempotency conflicts', () => {
    const adapter = new CodePressCommandAdapter({ document: documentWithCaptionTrack() })
    const batch = createCaptionCommandBatch(
      adapter,
      [
        {
          command_id: 'cue-1',
          type: 'upsert_caption_cues',
          track_id: 'captions-en',
          cues: [
            {
              item_type: 'caption_cue',
              cue_id: 'cue-1',
              track_id: 'captions-en',
              start_frame: 1,
              end_frame: 20,
              text: 'Replay me',
            },
          ],
        },
      ],
      ntsc,
      { operationId: 'caption-idempotent', idempotencyKey: 'caption-idempotent-key' },
    )
    expect(adapter.apply(batch).status).toBe('applied')
    expect(adapter.apply(batch).status).toBe('replayed')

    const idempotencyConflict = adapter.apply({
      ...batch,
      operation_id: 'different-operation',
      commands: [{ ...batch.commands[0]!, command_id: 'different-command' }],
    })
    expect(idempotencyConflict).toMatchObject({
      status: 'rejected',
      error: { code: 'idempotency_conflict' },
    })

    const stale = adapter.apply({
      ...batch,
      operation_id: 'stale-operation',
      idempotency_key: 'stale-key',
      base_revision: 0,
      commands: [{ ...batch.commands[0]!, command_id: 'stale-command', cues: [] }],
    })
    expect(stale).toMatchObject({ status: 'rejected', error: { code: 'revision_conflict' } })
  })
})
