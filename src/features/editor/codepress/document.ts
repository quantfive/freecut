import type {
  CaptionStyle,
  ClipItem,
  MediaReference,
  TextItem,
  TimelineItem,
  TimelineState,
  TimelineTrack,
} from './contract'
import type { ControlledEditorDocument } from './interfaces'
import {
  assertFrameAligned,
  framesToMicroseconds,
  normalizeFrameRate,
  type FrameRateLike,
} from './timing'

/** Minimal frame-native document shape expected from a FreeCut host. */
export interface FreeCutFrameClip {
  type: 'video' | 'audio' | 'image'
  id: string
  trackId: string
  mediaId: string
  linkedGroupId?: string | null
  rippleLinked?: boolean
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
  linkedGroupId?: string | null
  rippleLinked?: boolean
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
  linkedGroupId?: string | null
  rippleLinked?: boolean
  text: string
  speaker?: string | null
  style?: CaptionStyle
}

export type FreeCutFrameItem = FreeCutFrameClip | FreeCutFrameText | FreeCutFrameCaptionCue

export interface FreeCutFrameTrack {
  id: string
  kind: 'video' | 'audio' | 'overlay' | 'caption'
  name: string
  language?: string
  locked: boolean
  muted: boolean
  syncLock?: boolean
  parentTrackId?: string | null
  isGroup?: boolean
  defaultStyle?: CaptionStyle | null
  items: readonly FreeCutFrameItem[]
}

export interface FreeCutFrameDocument {
  timelineId: string
  revision: number
  fps: FrameRateLike
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

function frameRange(
  item: FreeCutFrameItem,
  fps: FrameRateLike,
): { start_us: number; end_us: number } {
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

function toContractItem(item: FreeCutFrameItem, fps: FrameRateLike): TimelineItem {
  const range = frameRange(item, fps)
  if (item.type === 'caption_cue') {
    return {
      item_type: 'caption_cue',
      cue_id: item.id,
      track_id: item.trackId,
      start_us: range.start_us,
      end_us: range.end_us,
      text: item.text,
      ...(item.linkedGroupId !== undefined ? { linked_group_id: item.linkedGroupId } : {}),
      ...(item.rippleLinked !== undefined ? { ripple_linked: item.rippleLinked } : {}),
      ...(item.speaker !== undefined ? { speaker: item.speaker } : {}),
      ...(item.style !== undefined ? { style: { ...item.style } } : {}),
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
      ...(item.linkedGroupId !== undefined ? { linked_group_id: item.linkedGroupId } : {}),
      ...(item.rippleLinked !== undefined ? { ripple_linked: item.rippleLinked } : {}),
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
  // The wire shape requires a concrete source window, but a frame document
  // that states none means "play from the start of the media" — source frame
  // 0, not the timeline position.  Defaulting to `item.from` puts a different
  // part of the media on the wire every time the clip is moved.
  const sourceStart = item.sourceStart ?? 0
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
    ...(item.linkedGroupId !== undefined ? { linked_group_id: item.linkedGroupId } : {}),
    ...(item.rippleLinked !== undefined ? { ripple_linked: item.rippleLinked } : {}),
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

function toTrack(track: FreeCutFrameTrack, fps: FrameRateLike): TimelineTrack {
  return {
    track_id: track.id,
    kind: track.kind,
    name: track.name,
    ...(track.language !== undefined ? { language: track.language } : {}),
    locked: track.locked,
    muted: track.muted,
    ...(track.syncLock !== undefined ? { sync_lock: track.syncLock } : {}),
    ...(track.parentTrackId !== undefined ? { parent_track_id: track.parentTrackId } : {}),
    ...(track.isGroup !== undefined ? { is_group: track.isGroup } : {}),
    ...(track.defaultStyle !== undefined ? { default_style: track.defaultStyle } : {}),
    items: track.items.map((item) => toContractItem(item, fps)),
  }
}

export function freeCutDocumentToControlledDocument(
  input: FreeCutFrameDocument,
): ControlledEditorDocument {
  try {
    normalizeFrameRate(input.fps)
  } catch (error) {
    throw new FreeCutDocumentConversionError(
      error instanceof Error ? error.message : 'fps must be a finite positive rate',
    )
  }
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

interface FrameBounds {
  start: number
  end: number
}

function frameBounds(
  start_us: number,
  end_us: number,
  fps: FrameRateLike,
  label: string,
): FrameBounds {
  const start = assertFrameAligned(start_us, fps)
  const end = assertFrameAligned(end_us, fps)
  if (end <= start) throw new FreeCutDocumentConversionError(`${label} has an empty frame range`)
  return { start, end }
}

function fromContractItem(item: TimelineItem, fps: FrameRateLike): FreeCutFrameItem {
  if (item.item_type === 'caption_cue') {
    const range = frameBounds(item.start_us, item.end_us, fps, `Caption cue "${item.cue_id}"`)
    return {
      type: 'caption_cue',
      id: item.cue_id,
      trackId: item.track_id,
      from: range.start,
      durationInFrames: range.end - range.start,
      text: item.text,
      ...(item.linked_group_id !== undefined ? { linkedGroupId: item.linked_group_id } : {}),
      ...(item.ripple_linked !== undefined ? { rippleLinked: item.ripple_linked } : {}),
      ...(item.speaker !== undefined ? { speaker: item.speaker } : {}),
      ...(item.style !== undefined ? { style: { ...item.style } } : {}),
    }
  }
  if (item.item_type === 'text') {
    const range = frameBounds(
      item.timeline_start_us,
      item.timeline_end_us,
      fps,
      `Text item "${item.item_id}"`,
    )
    return {
      type: 'text',
      id: item.item_id,
      trackId: item.track_id,
      from: range.start,
      durationInFrames: range.end - range.start,
      text: item.text,
      ...(item.linked_group_id !== undefined ? { linkedGroupId: item.linked_group_id } : {}),
      ...(item.ripple_linked !== undefined ? { rippleLinked: item.ripple_linked } : {}),
      ...(item.style ? { style: { ...item.style } } : {}),
      ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
      ...(item.transform ? { transform: fromTransform(item.transform) } : {}),
    }
  }
  const timelineRange = frameBounds(
    item.timeline_start_us,
    item.timeline_end_us,
    fps,
    `Clip "${item.item_id}"`,
  )
  const sourceRange = frameBounds(
    item.source_start_us,
    item.source_end_us,
    fps,
    `Clip "${item.item_id}" source`,
  )
  return {
    type: item.media_kind,
    id: item.item_id,
    trackId: item.track_id,
    mediaId: item.media_id,
    from: timelineRange.start,
    durationInFrames: timelineRange.end - timelineRange.start,
    sourceStart: sourceRange.start,
    sourceEnd: sourceRange.end,
    ...(item.linked_group_id !== undefined ? { linkedGroupId: item.linked_group_id } : {}),
    ...(item.ripple_linked !== undefined ? { rippleLinked: item.ripple_linked } : {}),
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
      ...(track.sync_lock !== undefined ? { syncLock: track.sync_lock } : {}),
      ...(track.parent_track_id !== undefined ? { parentTrackId: track.parent_track_id } : {}),
      ...(track.is_group !== undefined ? { isGroup: track.is_group } : {}),
      ...(track.default_style !== undefined ? { defaultStyle: track.default_style } : {}),
      items: track.items.map((item) => fromContractItem(item, document.fps)),
    })),
    width: document.width,
    height: document.height,
    ...(document.background_color !== undefined
      ? { backgroundColor: document.background_color }
      : {}),
  }
}
