import type {
  ClipItem,
  MediaReference,
  TextItem,
  TimelineItem,
  TimelineState,
  TimelineTrack,
} from './contract'
import type { ControlledEditorDocument } from './interfaces'
import { assertFrameAligned, framesToMicroseconds } from './timing'

/** Minimal frame-native document shape expected from a FreeCut host. */
export interface FreeCutFrameClip {
  type: 'video' | 'audio' | 'image'
  id: string
  trackId: string
  mediaId: string
  from: number
  durationInFrames: number
  sourceStart?: number
  sourceEnd?: number
  volume?: number
  speed?: number
  opacity?: number
  transform?: Record<string, number>
}

export interface FreeCutFrameText {
  type: 'text'
  id: string
  trackId: string
  from: number
  durationInFrames: number
  text: string
  style?: Record<string, string | number>
  opacity?: number
  transform?: Record<string, number>
}

export interface FreeCutFrameCaptionCue {
  type: 'caption_cue'
  id: string
  trackId: string
  from: number
  durationInFrames: number
  text: string
  speaker?: string | null
}

export type FreeCutFrameItem = FreeCutFrameClip | FreeCutFrameText | FreeCutFrameCaptionCue

export interface FreeCutFrameTrack {
  id: string
  kind: 'video' | 'audio' | 'overlay' | 'caption'
  name: string
  language?: string
  locked: boolean
  muted: boolean
  items: readonly FreeCutFrameItem[]
}

export interface FreeCutFrameDocument {
  timelineId: string
  revision: number
  fps: number
  durationInFrames: number
  media: readonly MediaReference[]
  tracks: readonly FreeCutFrameTrack[]
  width: number
  height: number
  backgroundColor?: string
}

export class FreeCutDocumentConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FreeCutDocumentConversionError'
  }
}

function frameRange(item: FreeCutFrameItem, fps: number): { start_us: number; end_us: number } {
  if (
    !Number.isSafeInteger(item.from) ||
    item.from < 0 ||
    !Number.isSafeInteger(item.durationInFrames) ||
    item.durationInFrames <= 0
  ) {
    throw new FreeCutDocumentConversionError(
      `Item "${item.id}" must have non-negative integer frame bounds`,
    )
  }
  const start_us = framesToMicroseconds(item.from, fps)
  const end_us = framesToMicroseconds(item.from + item.durationInFrames, fps)
  if (end_us <= start_us)
    throw new FreeCutDocumentConversionError(`Item "${item.id}" has an empty frame range`)
  return { start_us, end_us }
}

function toContractItem(item: FreeCutFrameItem, fps: number): TimelineItem {
  const range = frameRange(item, fps)
  if (item.type === 'caption_cue') {
    return {
      item_type: 'caption_cue',
      cue_id: item.id,
      track_id: item.trackId,
      start_us: range.start_us,
      end_us: range.end_us,
      text: item.text,
      ...(item.speaker !== undefined ? { speaker: item.speaker } : {}),
    }
  }
  if (item.type === 'text') {
    return {
      item_type: 'text',
      item_id: item.id,
      track_id: item.trackId,
      timeline_start_us: range.start_us,
      timeline_end_us: range.end_us,
      text: item.text,
      ...(item.style
        ? {
            style: {
              ...(typeof item.style.font_family === 'string'
                ? { font_family: item.style.font_family }
                : {}),
              ...(typeof item.style.font_size === 'number'
                ? { font_size: item.style.font_size }
                : {}),
              ...(typeof item.style.color === 'string' ? { color: item.style.color } : {}),
              ...(item.style.alignment === 'left' ||
              item.style.alignment === 'center' ||
              item.style.alignment === 'right'
                ? { alignment: item.style.alignment }
                : {}),
            },
          }
        : {}),
      ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
      ...(item.transform ? { transform: toTransform(item.transform) } : {}),
    }
  }
  const mediaKind = item.type
  const sourceStart = item.sourceStart ?? item.from
  const sourceEnd = item.sourceEnd ?? sourceStart + item.durationInFrames
  if (
    !Number.isSafeInteger(sourceStart) ||
    !Number.isSafeInteger(sourceEnd) ||
    sourceEnd <= sourceStart
  ) {
    throw new FreeCutDocumentConversionError(`Clip "${item.id}" has invalid source bounds`)
  }
  return {
    item_type: 'clip',
    item_id: item.id,
    track_id: item.trackId,
    media_id: item.mediaId,
    media_kind: mediaKind,
    timeline_start_us: range.start_us,
    timeline_end_us: range.end_us,
    source_start_us: framesToMicroseconds(sourceStart, fps),
    source_end_us: framesToMicroseconds(sourceEnd, fps),
    ...(item.volume !== undefined ? { volume: item.volume } : {}),
    ...(item.speed !== undefined ? { speed: item.speed } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.transform ? { transform: toTransform(item.transform) } : {}),
  }
}

function toTransform(value: Record<string, number>): ClipItem['transform'] {
  return {
    position_x: value.position_x ?? value.x ?? 0,
    position_y: value.position_y ?? value.y ?? 0,
    scale_x: value.scale_x ?? value.scaleX ?? 1,
    scale_y: value.scale_y ?? value.scaleY ?? 1,
    rotation_degrees: value.rotation_degrees ?? value.rotation ?? 0,
    anchor_x: value.anchor_x ?? value.anchorX ?? 0,
    anchor_y: value.anchor_y ?? value.anchorY ?? 0,
  }
}

function fromTransform(
  value: ClipItem['transform'] | TextItem['transform'] | undefined,
): Record<string, number> | undefined {
  if (!value) return undefined
  return {
    position_x: value.position_x,
    position_y: value.position_y,
    scale_x: value.scale_x,
    scale_y: value.scale_y,
    rotation_degrees: value.rotation_degrees,
    anchor_x: value.anchor_x,
    anchor_y: value.anchor_y,
  }
}

function toTrack(track: FreeCutFrameTrack, fps: number): TimelineTrack {
  return {
    track_id: track.id,
    kind: track.kind,
    name: track.name,
    ...(track.language !== undefined ? { language: track.language } : {}),
    locked: track.locked,
    muted: track.muted,
    items: track.items.map((item) => toContractItem(item, fps)),
  }
}

export function freeCutDocumentToControlledDocument(
  input: FreeCutFrameDocument,
): ControlledEditorDocument {
  if (!Number.isFinite(input.fps) || input.fps <= 0)
    throw new FreeCutDocumentConversionError('fps must be a finite positive number')
  if (!Number.isSafeInteger(input.durationInFrames) || input.durationInFrames < 0)
    throw new FreeCutDocumentConversionError('durationInFrames must be a safe non-negative integer')
  const timeline: TimelineState = {
    contract_version: 1,
    schema_version: 1,
    timeline_id: input.timelineId,
    revision: input.revision,
    duration_us: framesToMicroseconds(input.durationInFrames, input.fps),
    media: input.media,
    tracks: input.tracks.map((track) => toTrack(track, input.fps)),
  }
  return {
    timeline,
    fps: input.fps,
    width: input.width,
    height: input.height,
    ...(input.backgroundColor !== undefined ? { background_color: input.backgroundColor } : {}),
  }
}

function fromContractItem(item: TimelineItem, fps: number): FreeCutFrameItem {
  if (item.item_type === 'caption_cue') {
    return {
      type: 'caption_cue',
      id: item.cue_id,
      trackId: item.track_id,
      from: assertFrameAligned(item.start_us, fps),
      durationInFrames: assertFrameAligned(item.end_us - item.start_us, fps),
      text: item.text,
      ...(item.speaker !== undefined ? { speaker: item.speaker } : {}),
    }
  }
  if (item.item_type === 'text') {
    return {
      type: 'text',
      id: item.item_id,
      trackId: item.track_id,
      from: assertFrameAligned(item.timeline_start_us, fps),
      durationInFrames: assertFrameAligned(item.timeline_end_us - item.timeline_start_us, fps),
      text: item.text,
      ...(item.style ? { style: { ...item.style } } : {}),
      ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
      ...(item.transform ? { transform: fromTransform(item.transform) } : {}),
    }
  }
  return {
    type: item.media_kind,
    id: item.item_id,
    trackId: item.track_id,
    mediaId: item.media_id,
    from: assertFrameAligned(item.timeline_start_us, fps),
    durationInFrames: assertFrameAligned(item.timeline_end_us - item.timeline_start_us, fps),
    sourceStart: assertFrameAligned(item.source_start_us, fps),
    sourceEnd: assertFrameAligned(item.source_end_us, fps),
    ...(item.volume !== undefined ? { volume: item.volume } : {}),
    ...(item.speed !== undefined ? { speed: item.speed } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.transform ? { transform: fromTransform(item.transform) } : {}),
  }
}

export function controlledDocumentToFreeCutDocument(
  document: ControlledEditorDocument,
): FreeCutFrameDocument {
  return {
    timelineId: document.timeline.timeline_id,
    revision: document.timeline.revision,
    fps: document.fps,
    durationInFrames: assertFrameAligned(document.timeline.duration_us, document.fps),
    media: document.timeline.media,
    tracks: document.timeline.tracks.map((track) => ({
      id: track.track_id,
      kind: track.kind,
      name: track.name,
      ...(track.language !== undefined ? { language: track.language } : {}),
      locked: track.locked,
      muted: track.muted,
      items: track.items.map((item) => fromContractItem(item, document.fps)),
    })),
    width: document.width,
    height: document.height,
    ...(document.background_color !== undefined
      ? { backgroundColor: document.background_color }
      : {}),
  }
}
