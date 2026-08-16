import {
  assertFrameAligned,
  framesToMicroseconds,
  normalizeFrameRate,
  type FrameRateLike,
} from './timing'
import type {
  AddCaptionTrackCommand,
  AddClipCommand,
  AddTextCommand,
  AppliedCommandResult,
  CaptionCue,
  ClipItem,
  CommandEffect,
  EditCommand,
  Effect,
  ItemPropertiesPatch,
  Keyframe,
  MoveItemCommand,
  SetItemPropertiesCommand,
  TimelineItem,
  TimelineState,
  TimelineTrack,
  TrackId,
} from './contract'
import { MAX_ID_LENGTH, validateTimelineState } from './contract'
import type { ControlledEditEngine, EditEngineContext, EditEngineResult } from './interfaces'

export class EditEngineError extends Error {
  readonly code:
    | 'unknown_track'
    | 'unknown_item'
    | 'unknown_media'
    | 'invalid_request'
    | 'unsupported_command'
  readonly command_id?: string

  constructor(code: EditEngineError['code'], message: string, command_id?: string) {
    super(message)
    this.name = 'EditEngineError'
    this.code = code
    this.command_id = command_id
  }
}

interface LocatedItem {
  item: TimelineItem
  trackIndex: number
  itemIndex: number
}

interface MutableTimeline extends TimelineState {
  tracks: TimelineTrack[]
}

function emptyEffect(timeline_delta_us = 0): CommandEffect {
  return {
    created_item_ids: [],
    updated_item_ids: [],
    deleted_item_ids: [],
    moved_item_ids: [],
    created_track_ids: [],
    updated_track_ids: [],
    deleted_track_ids: [],
    timeline_delta_us,
  }
}

function cloneItem(item: TimelineItem): TimelineItem {
  if (item.item_type === 'caption_cue') {
    return { ...item, style: item.style ? { ...item.style } : undefined }
  }
  if (item.item_type === 'text') {
    return {
      ...item,
      transform: item.transform ? { ...item.transform } : undefined,
      keyframes: item.keyframes?.map((keyframe) => ({ ...keyframe })),
      style: item.style ? { ...item.style } : undefined,
    }
  }
  return {
    ...item,
    transform: item.transform ? { ...item.transform } : undefined,
    effects: item.effects?.map((effect) => ({ ...effect })),
    keyframes: item.keyframes?.map((keyframe) => ({ ...keyframe })),
    transition_in: item.transition_in ? { ...item.transition_in } : item.transition_in,
    transition_out: item.transition_out ? { ...item.transition_out } : item.transition_out,
  }
}

function cloneTimeline(timeline: TimelineState): MutableTimeline {
  return {
    ...timeline,
    media: timeline.media.map((media) => ({ ...media })),
    tracks: timeline.tracks.map((track) => ({
      ...track,
      default_style: track.default_style ? { ...track.default_style } : track.default_style,
      items: track.items.map(cloneItem),
    })),
  }
}

function allItems(timeline: MutableTimeline): TimelineItem[] {
  return timeline.tracks.flatMap((track) => track.items)
}

function findTrack(timeline: MutableTimeline, trackId: TrackId, commandId?: string): TimelineTrack {
  const track = timeline.tracks.find((candidate) => candidate.track_id === trackId)
  if (!track)
    throw new EditEngineError('unknown_track', `Track "${trackId}" does not exist`, commandId)
  return track
}

function findItem(timeline: MutableTimeline, itemId: string, commandId?: string): LocatedItem {
  for (const [trackIndex, track] of timeline.tracks.entries()) {
    const itemIndex = track.items.findIndex((item) =>
      item.item_type === 'caption_cue' ? item.cue_id === itemId : item.item_id === itemId,
    )
    if (itemIndex >= 0) return { item: track.items[itemIndex]!, trackIndex, itemIndex }
  }
  throw new EditEngineError('unknown_item', `Item "${itemId}" does not exist`, commandId)
}

function itemId(item: TimelineItem): string {
  return item.item_type === 'caption_cue' ? item.cue_id : item.item_id
}

function itemStart(item: TimelineItem): number {
  return item.item_type === 'caption_cue' ? item.start_us : item.timeline_start_us
}

function itemEnd(item: TimelineItem): number {
  return item.item_type === 'caption_cue' ? item.end_us : item.timeline_end_us
}

function replaceTrackItems(
  timeline: MutableTimeline,
  trackIndex: number,
  items: TimelineItem[],
): void {
  timeline.tracks[trackIndex] = { ...timeline.tracks[trackIndex]!, items }
}

function insertAt<T>(values: readonly T[], value: T, index: number | undefined): T[] {
  const next = [...values]
  const target = Math.min(Math.max(index ?? next.length, 0), next.length)
  next.splice(target, 0, value)
  return next
}

function setItemAt(timeline: MutableTimeline, located: LocatedItem, item: TimelineItem): void {
  const track = timeline.tracks[located.trackIndex]!
  const items = [...track.items]
  items[located.itemIndex] = item
  replaceTrackItems(timeline, located.trackIndex, items)
}

function removeItemAt(timeline: MutableTimeline, located: LocatedItem): void {
  const track = timeline.tracks[located.trackIndex]!
  replaceTrackItems(
    timeline,
    located.trackIndex,
    track.items.filter((_, index) => index !== located.itemIndex),
  )
}

function setItemPosition(item: TimelineItem, start_us: number, end_us: number): TimelineItem {
  if (item.item_type === 'caption_cue') return { ...item, start_us, end_us }
  return { ...item, timeline_start_us: start_us, timeline_end_us: end_us }
}

function setItemTrack(item: TimelineItem, track_id: TrackId): TimelineItem {
  return item.item_type === 'caption_cue' ? { ...item, track_id } : { ...item, track_id }
}

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  return remainder * 2n >= denominator ? quotient + 1n : quotient
}

function sourceAtTimelineFrame(item: ClipItem, timelineFrame: number, fps: FrameRateLike): number {
  const timelineStartFrame = assertFrameAligned(item.timeline_start_us, fps)
  const timelineEndFrame = assertFrameAligned(item.timeline_end_us, fps)
  const sourceStartFrame = assertFrameAligned(item.source_start_us, fps)
  const sourceEndFrame = assertFrameAligned(item.source_end_us, fps)
  const timelineDuration = timelineEndFrame - timelineStartFrame
  const sourceDuration = sourceEndFrame - sourceStartFrame
  if (timelineFrame <= timelineStartFrame) return item.source_start_us
  if (timelineFrame >= timelineEndFrame) return item.source_end_us
  const sourceOffset = roundedRatio(
    BigInt(timelineFrame - timelineStartFrame) * BigInt(sourceDuration),
    BigInt(timelineDuration),
  )
  return framesToMicroseconds(sourceStartFrame + Number(sourceOffset), fps)
}

function frameRangeFor(item: TimelineItem, fps: FrameRateLike): { start: number; end: number } {
  return {
    start: assertFrameAligned(itemStart(item), fps),
    end: assertFrameAligned(itemEnd(item), fps),
  }
}

function setItemFramePosition(
  item: TimelineItem,
  startFrame: number,
  endFrame: number,
  fps: FrameRateLike,
): TimelineItem {
  return setItemPosition(
    item,
    framesToMicroseconds(startFrame, fps),
    framesToMicroseconds(endFrame, fps),
  )
}

function shiftItemByFrames(
  item: TimelineItem,
  deltaFrames: number,
  fps: FrameRateLike,
): TimelineItem {
  const range = frameRangeFor(item, fps)
  return setItemFramePosition(item, range.start - deltaFrames, range.end - deltaFrames, fps)
}

function deriveFragmentId(originalId: string, usedIds: Set<string>): string {
  const candidate = (suffix: string): string =>
    `${originalId.slice(0, Math.max(0, MAX_ID_LENGTH - suffix.length))}${suffix}`
  const base = candidate(':ripple-right')
  if (!usedIds.has(base)) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const collisionSafe = candidate(`:ripple-${suffix}`)
    if (!usedIds.has(collisionSafe)) return collisionSafe
  }
  throw new EditEngineError(
    'invalid_request',
    `Cannot derive a unique ripple fragment ID for "${originalId}"`,
  )
}

function trimItemToFrameRange(
  item: TimelineItem,
  startFrame: number,
  endFrame: number,
  fps: FrameRateLike,
): TimelineItem {
  const start_us = framesToMicroseconds(startFrame, fps)
  const end_us = framesToMicroseconds(endFrame, fps)
  if (item.item_type === 'clip') {
    return {
      ...item,
      timeline_start_us: start_us,
      timeline_end_us: end_us,
      source_start_us: sourceAtTimelineFrame(item, startFrame, fps),
      source_end_us: sourceAtTimelineFrame(item, endFrame, fps),
    }
  }
  return setItemPosition(item, start_us, end_us)
}

function expandRippleItem(
  item: TimelineItem,
  startFrame: number,
  endFrame: number,
  deltaFrames: number,
  fps: FrameRateLike,
  usedIds: Set<string>,
): { items: TimelineItem[]; created: string[]; updated: string[]; deleted: string[] } {
  const id = itemId(item)
  const range = frameRangeFor(item, fps)
  if (range.end <= startFrame) return { items: [item], created: [], updated: [], deleted: [] }
  if (range.start >= endFrame)
    return {
      items: [shiftItemByFrames(item, deltaFrames, fps)],
      created: [],
      updated: [id],
      deleted: [],
    }

  const hasLeft = range.start < startFrame
  const hasRight = range.end > endFrame
  if (!hasLeft && !hasRight) return { items: [], created: [], updated: [], deleted: [id] }

  const result: TimelineItem[] = []
  const created: string[] = []
  const updated = [id]
  const deleted: string[] = []
  if (hasLeft) result.push(trimItemToFrameRange(item, range.start, startFrame, fps))
  if (hasRight) {
    const right = trimItemToFrameRange(item, endFrame, range.end, fps)
    const shifted = shiftItemByFrames(right, deltaFrames, fps)
    if (hasLeft) {
      const fragmentId = deriveFragmentId(id, usedIds)
      usedIds.add(fragmentId)
      result.push(
        shifted.item_type === 'caption_cue'
          ? { ...shifted, cue_id: fragmentId }
          : { ...shifted, item_id: fragmentId },
      )
      created.push(fragmentId)
    } else {
      result.push(shifted)
    }
  }
  return { items: result, created, updated, deleted }
}

function ensureTrackCompatibility(
  track: TimelineTrack,
  item: TimelineItem,
  commandId: string,
): void {
  if (track.kind === 'caption' && item.item_type !== 'caption_cue')
    throw new EditEngineError(
      'invalid_request',
      `Track "${track.track_id}" accepts caption cues only`,
      commandId,
    )
  if (track.kind !== 'caption' && item.item_type === 'caption_cue')
    throw new EditEngineError(
      'invalid_request',
      `Caption cue "${itemId(item)}" requires a caption track`,
      commandId,
    )
  if (track.kind === 'audio' && item.item_type === 'clip' && item.media_kind !== 'audio')
    throw new EditEngineError(
      'invalid_request',
      `Audio track "${track.track_id}" accepts audio clips only`,
      commandId,
    )
}

function ensureUniqueItemId(timeline: MutableTimeline, id: string, commandId: string): void {
  if (allItems(timeline).some((item) => itemId(item) === id))
    throw new EditEngineError('invalid_request', `Item ID "${id}" already exists`, commandId)
}

function ensureMedia(timeline: MutableTimeline, mediaId: string, commandId: string): void {
  if (!timeline.media.some((media) => media.media_id === mediaId))
    throw new EditEngineError('unknown_media', `Media "${mediaId}" does not exist`, commandId)
}

function recomputeDuration(timeline: MutableTimeline): void {
  const maxEnd = allItems(timeline).reduce((max, item) => Math.max(max, itemEnd(item)), 0)
  if (maxEnd > timeline.duration_us) timeline.duration_us = maxEnd
}

function applyAddClip(timeline: MutableTimeline, command: AddClipCommand): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  const item = cloneItem(command.item) as ClipItem
  ensureMedia(timeline, item.media_id, command.command_id)
  ensureUniqueItemId(timeline, item.item_id, command.command_id)
  ensureTrackCompatibility(track, item, command.command_id)
  replaceTrackItems(
    timeline,
    timeline.tracks.indexOf(track),
    insertAt(track.items, item, command.index),
  )
  recomputeDuration(timeline)
  return { ...emptyEffect(), created_item_ids: [item.item_id] }
}

function applyAddText(timeline: MutableTimeline, command: AddTextCommand): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  const item = cloneItem(command.item) as Extract<TimelineItem, { item_type: 'text' }>
  ensureUniqueItemId(timeline, item.item_id, command.command_id)
  ensureTrackCompatibility(track, item, command.command_id)
  replaceTrackItems(
    timeline,
    timeline.tracks.indexOf(track),
    insertAt(track.items, item, command.index),
  )
  recomputeDuration(timeline)
  return { ...emptyEffect(), created_item_ids: [item.item_id] }
}

function applyDuplicate(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'duplicate_item' }>,
): CommandEffect {
  const source = findItem(timeline, command.item_id, command.command_id).item
  const target = findTrack(timeline, command.to_track_id, command.command_id)
  ensureUniqueItemId(timeline, command.new_item_id, command.command_id)
  const duplicate = cloneItem(source)
  const sourceStart = itemStart(source)
  const targetStart = command.timeline_start_us ?? sourceStart
  const shifted = setItemPosition(
    duplicate,
    targetStart,
    targetStart + (itemEnd(source) - sourceStart),
  )
  const withId =
    shifted.item_type === 'caption_cue'
      ? { ...shifted, cue_id: command.new_item_id, track_id: target.track_id }
      : { ...shifted, item_id: command.new_item_id, track_id: target.track_id }
  ensureTrackCompatibility(target, withId, command.command_id)
  replaceTrackItems(
    timeline,
    timeline.tracks.indexOf(target),
    insertAt(target.items, withId, command.index),
  )
  recomputeDuration(timeline)
  return { ...emptyEffect(), created_item_ids: [command.new_item_id] }
}

function applyRemoveItem(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'remove_item' }>,
): CommandEffect {
  const located = findItem(timeline, command.item_id, command.command_id)
  removeItemAt(timeline, located)
  return { ...emptyEffect(), deleted_item_ids: [command.item_id] }
}

function applyMoveItem(timeline: MutableTimeline, command: MoveItemCommand): CommandEffect {
  const located = findItem(timeline, command.item_id, command.command_id)
  const target = findTrack(timeline, command.to_track_id, command.command_id)
  ensureTrackCompatibility(target, located.item, command.command_id)
  const oldStart = itemStart(located.item)
  const moved = setItemPosition(
    setItemTrack(located.item, target.track_id),
    command.timeline_start_us,
    command.timeline_start_us + itemEnd(located.item) - oldStart,
  )
  const sourceTrack = timeline.tracks[located.trackIndex]!
  const sourceItems = sourceTrack.items.filter((_, index) => index !== located.itemIndex)
  const targetIndex = timeline.tracks.indexOf(target)
  replaceTrackItems(timeline, located.trackIndex, sourceItems)
  const targetItems = targetIndex === located.trackIndex ? sourceItems : target.items
  replaceTrackItems(timeline, targetIndex, insertAt(targetItems, moved, command.index))
  return {
    ...emptyEffect(),
    moved_item_ids: [command.item_id],
    updated_item_ids: [command.item_id],
  }
}

function applyTrim(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'trim_item' }>,
): CommandEffect {
  const located = findItem(timeline, command.item_id, command.command_id)
  const item = located.item
  const next =
    command.edge === 'start'
      ? item.item_type === 'clip'
        ? { ...item, timeline_start_us: command.timeline_us, source_start_us: command.source_us }
        : item.item_type === 'caption_cue'
          ? { ...item, start_us: command.timeline_us }
          : { ...item, timeline_start_us: command.timeline_us }
      : item.item_type === 'clip'
        ? { ...item, timeline_end_us: command.timeline_us, source_end_us: command.source_us }
        : item.item_type === 'caption_cue'
          ? { ...item, end_us: command.timeline_us }
          : { ...item, timeline_end_us: command.timeline_us }
  if (itemEnd(next) <= itemStart(next))
    throw new EditEngineError(
      'invalid_request',
      `Trim would make item "${command.item_id}" empty`,
      command.command_id,
    )
  setItemAt(timeline, located, next)
  return { ...emptyEffect(), updated_item_ids: [command.item_id] }
}

function applySplit(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'split_item' }>,
): CommandEffect {
  const located = findItem(timeline, command.item_id, command.command_id)
  if (located.item.item_type === 'caption_cue')
    throw new EditEngineError(
      'unsupported_command',
      'Caption cues use upsert_caption_cues rather than split_item',
      command.command_id,
    )
  if (
    command.at_timeline_us <= located.item.timeline_start_us ||
    command.at_timeline_us >= located.item.timeline_end_us
  )
    throw new EditEngineError(
      'invalid_request',
      'Split must be inside the item range',
      command.command_id,
    )
  ensureUniqueItemId(timeline, command.left_item_id, command.command_id)
  ensureUniqueItemId(timeline, command.right_item_id, command.command_id)
  const item = located.item
  const left =
    item.item_type === 'clip'
      ? {
          ...item,
          item_id: command.left_item_id,
          timeline_end_us: command.at_timeline_us,
          source_end_us: command.at_source_us,
        }
      : { ...item, item_id: command.left_item_id, timeline_end_us: command.at_timeline_us }
  const right =
    item.item_type === 'clip'
      ? {
          ...item,
          item_id: command.right_item_id,
          timeline_start_us: command.at_timeline_us,
          source_start_us: command.at_source_us,
        }
      : { ...item, item_id: command.right_item_id, timeline_start_us: command.at_timeline_us }
  const track = timeline.tracks[located.trackIndex]!
  const items = [...track.items]
  items.splice(located.itemIndex, 1, left, right)
  replaceTrackItems(timeline, located.trackIndex, items)
  return {
    ...emptyEffect(),
    created_item_ids: [command.left_item_id, command.right_item_id],
    deleted_item_ids: [command.item_id],
  }
}

function applyRippleDelete(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'ripple_delete' }>,
  fps: FrameRateLike,
): CommandEffect {
  const startFrame = assertFrameAligned(command.start_us, fps)
  const endFrame = assertFrameAligned(command.end_us, fps)
  const deltaFrames = endFrame - startFrame
  const previousDuration = timeline.duration_us
  const selected = command.track_ids === null ? null : new Set(command.track_ids)
  for (const trackId of selected ?? []) findTrack(timeline, trackId, command.command_id)
  const usedIds = new Set(allItems(timeline).map(itemId))
  const created: string[] = []
  const updated: string[] = []
  const deleted: string[] = []
  for (const [trackIndex, track] of timeline.tracks.entries()) {
    if (selected !== null && !selected.has(track.track_id)) continue
    const nextItems: TimelineItem[] = []
    for (const item of track.items) {
      const result = expandRippleItem(item, startFrame, endFrame, deltaFrames, fps, usedIds)
      nextItems.push(...result.items)
      created.push(...result.created)
      updated.push(...result.updated)
      deleted.push(...result.deleted)
    }
    replaceTrackItems(timeline, trackIndex, nextItems)
  }
  if (selected === null) {
    const previousDurationFrames = assertFrameAligned(previousDuration, fps)
    timeline.duration_us = framesToMicroseconds(
      Math.max(0, previousDurationFrames - deltaFrames),
      fps,
    )
  }
  recomputeDuration(timeline)
  const durationDelta = selected === null ? timeline.duration_us - previousDuration : 0
  return {
    ...emptyEffect(durationDelta),
    created_item_ids: created,
    updated_item_ids: [...new Set(updated.filter((id) => !deleted.includes(id)))],
    deleted_item_ids: [...new Set(deleted)],
  }
}

function applyAddTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'add_track' }>,
): CommandEffect {
  if (timeline.tracks.some((track) => track.track_id === command.track.track_id))
    throw new EditEngineError(
      'invalid_request',
      `Track ID "${command.track.track_id}" already exists`,
      command.command_id,
    )
  const track: TimelineTrack = { ...command.track, items: [] }
  timeline.tracks = insertAt(timeline.tracks, track, command.index)
  return { ...emptyEffect(), created_track_ids: [track.track_id] }
}

function applyRemoveTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'remove_track' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  const deletedItemIds = track.items.map(itemId)
  timeline.tracks = timeline.tracks.filter((candidate) => candidate.track_id !== command.track_id)
  return {
    ...emptyEffect(),
    deleted_track_ids: [command.track_id],
    deleted_item_ids: deletedItemIds,
  }
}

function applyMoveTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'move_track' }>,
): CommandEffect {
  const sourceIndex = timeline.tracks.findIndex((track) => track.track_id === command.track_id)
  if (sourceIndex < 0) findTrack(timeline, command.track_id, command.command_id)
  const [track] = timeline.tracks.splice(sourceIndex, 1)
  timeline.tracks.splice(Math.min(command.to_index, timeline.tracks.length), 0, track!)
  return { ...emptyEffect(), updated_track_ids: [command.track_id] }
}

function applyUpdateTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'update_track' }>,
): CommandEffect {
  const located = findTrack(timeline, command.track_id, command.command_id)
  const index = timeline.tracks.indexOf(located)
  timeline.tracks[index] = {
    ...located,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.language !== undefined ? { language: command.language ?? undefined } : {}),
    ...(command.locked !== undefined ? { locked: command.locked } : {}),
    ...(command.muted !== undefined ? { muted: command.muted } : {}),
  }
  return { ...emptyEffect(), updated_track_ids: [command.track_id] }
}

function applyAddCaptionTrack(
  timeline: MutableTimeline,
  command: AddCaptionTrackCommand,
): CommandEffect {
  if (timeline.tracks.some((track) => track.track_id === command.track_id))
    throw new EditEngineError(
      'invalid_request',
      `Track ID "${command.track_id}" already exists`,
      command.command_id,
    )
  const track: TimelineTrack = {
    track_id: command.track_id,
    kind: 'caption',
    name: command.name,
    language: command.language,
    locked: false,
    muted: false,
    items: [],
  }
  timeline.tracks = insertAt(timeline.tracks, track, command.index)
  return { ...emptyEffect(), created_track_ids: [track.track_id] }
}

function applyRemoveCaptionTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'remove_caption_track' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  if (track.kind !== 'caption')
    throw new EditEngineError(
      'invalid_request',
      `Track "${command.track_id}" is not a caption track`,
      command.command_id,
    )
  return applyRemoveTrack(timeline, {
    command_id: command.command_id,
    type: 'remove_track',
    track_id: command.track_id,
  })
}

function applyUpdateCaptionTrack(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'update_caption_track' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  if (track.kind !== 'caption')
    throw new EditEngineError(
      'invalid_request',
      `Track "${command.track_id}" is not a caption track`,
      command.command_id,
    )
  const index = timeline.tracks.indexOf(track)
  timeline.tracks[index] = {
    ...track,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.language !== undefined ? { language: command.language } : {}),
    ...(command.default_style !== undefined
      ? { default_style: command.default_style ? { ...command.default_style } : null }
      : {}),
  }
  return { ...emptyEffect(), updated_track_ids: [command.track_id] }
}

function applyUpsertCaptionCues(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'upsert_caption_cues' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  if (track.kind !== 'caption')
    throw new EditEngineError(
      'invalid_request',
      `Track "${command.track_id}" is not a caption track`,
      command.command_id,
    )
  const incoming = command.cues.map((cue) => ({
    ...cue,
    style: cue.style ? { ...cue.style } : undefined,
  }))
  const incomingIds = new Set(incoming.map((cue) => cue.cue_id))
  const previous = track.items.filter(
    (item): item is CaptionCue => item.item_type === 'caption_cue',
  )
  const created = incoming
    .filter((cue) => !previous.some((existing) => existing.cue_id === cue.cue_id))
    .map((cue) => cue.cue_id)
  const updated = incoming
    .filter((cue) => previous.some((existing) => existing.cue_id === cue.cue_id))
    .map((cue) => cue.cue_id)
  const retained = previous.filter((cue) => !incomingIds.has(cue.cue_id))
  const items = [...retained, ...incoming].sort(
    (left, right) =>
      left.start_us - right.start_us ||
      left.end_us - right.end_us ||
      left.cue_id.localeCompare(right.cue_id),
  )
  replaceTrackItems(timeline, timeline.tracks.indexOf(track), items)
  recomputeDuration(timeline)
  return { ...emptyEffect(), created_item_ids: created, updated_item_ids: updated }
}

function applyRemoveCaptionCues(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'remove_caption_cues' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  if (track.kind !== 'caption')
    throw new EditEngineError(
      'invalid_request',
      `Track "${command.track_id}" is not a caption track`,
      command.command_id,
    )
  const ids = new Set(command.cue_ids)
  const deleted = track.items
    .filter((item) => item.item_type === 'caption_cue' && ids.has(item.cue_id))
    .map(itemId)
  replaceTrackItems(
    timeline,
    timeline.tracks.indexOf(track),
    track.items.filter((item) => item.item_type !== 'caption_cue' || !ids.has(item.cue_id)),
  )
  return { ...emptyEffect(), deleted_item_ids: deleted }
}

function applyProperties(
  timeline: MutableTimeline,
  command: SetItemPropertiesCommand,
): CommandEffect {
  const located = findItem(timeline, command.item_id, command.command_id)
  if (located.item.item_type === 'caption_cue')
    throw new EditEngineError(
      'unsupported_command',
      'Use caption commands to edit caption cues',
      command.command_id,
    )
  const patch: ItemPropertiesPatch = command.properties
  const item = located.item
  const next: TimelineItem = {
    ...item,
    ...(patch.transform !== undefined
      ? { transform: patch.transform ? { ...patch.transform } : undefined }
      : {}),
    ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    ...(patch.volume !== undefined ? { volume: patch.volume } : {}),
    ...(patch.speed !== undefined ? { speed: patch.speed } : {}),
    ...(patch.fade_in_us !== undefined ? { fade_in_us: patch.fade_in_us ?? undefined } : {}),
    ...(patch.fade_out_us !== undefined ? { fade_out_us: patch.fade_out_us ?? undefined } : {}),
    ...(patch.effects !== undefined
      ? { effects: patch.effects.map((effect: Effect) => ({ ...effect })) }
      : {}),
    ...(patch.keyframes !== undefined
      ? { keyframes: patch.keyframes.map((keyframe: Keyframe) => ({ ...keyframe })) }
      : {}),
    ...(patch.transition_in !== undefined
      ? { transition_in: patch.transition_in ? { ...patch.transition_in } : undefined }
      : {}),
    ...(patch.transition_out !== undefined
      ? { transition_out: patch.transition_out ? { ...patch.transition_out } : undefined }
      : {}),
    ...(item.item_type === 'text' && patch.text !== undefined ? { text: patch.text } : {}),
    ...(item.item_type === 'text' && patch.text_style !== undefined
      ? { style: patch.text_style ? { ...patch.text_style } : undefined }
      : {}),
  } as TimelineItem
  setItemAt(timeline, located, next)
  return { ...emptyEffect(), updated_item_ids: [command.item_id] }
}

function applyCaptionStyle(
  timeline: MutableTimeline,
  command: Extract<EditCommand, { type: 'set_caption_style' }>,
): CommandEffect {
  const track = findTrack(timeline, command.track_id, command.command_id)
  if (track.kind !== 'caption')
    throw new EditEngineError(
      'invalid_request',
      `Track "${command.track_id}" is not a caption track`,
      command.command_id,
    )
  if (command.cue_ids === null) {
    const index = timeline.tracks.indexOf(track)
    timeline.tracks[index] = { ...track, default_style: { ...command.style } }
    return { ...emptyEffect(), updated_track_ids: [command.track_id] }
  }
  const ids = new Set(command.cue_ids)
  const updated: string[] = []
  const items = track.items.map((item) => {
    if (item.item_type !== 'caption_cue' || !ids.has(item.cue_id)) return item
    updated.push(item.cue_id)
    return { ...item, style: { ...command.style } }
  })
  replaceTrackItems(timeline, timeline.tracks.indexOf(track), items)
  return { ...emptyEffect(), updated_item_ids: updated }
}

function applyCommand(
  timeline: MutableTimeline,
  command: EditCommand,
  fps: FrameRateLike,
): CommandEffect {
  // All command time fields are public microseconds. Conversion is performed
  // before mutation so a non-frame-aligned batch can never partially apply.
  switch (command.type) {
    case 'add_clip':
      assertFrameAligned(command.item.timeline_start_us, fps)
      assertFrameAligned(command.item.timeline_end_us, fps)
      assertFrameAligned(command.item.source_start_us, fps)
      assertFrameAligned(command.item.source_end_us, fps)
      return applyAddClip(timeline, command)
    case 'add_text':
      assertFrameAligned(command.item.timeline_start_us, fps)
      assertFrameAligned(command.item.timeline_end_us, fps)
      return applyAddText(timeline, command)
    case 'duplicate_item':
      if (command.timeline_start_us !== undefined)
        assertFrameAligned(command.timeline_start_us, fps)
      return applyDuplicate(timeline, command)
    case 'remove_item':
      return applyRemoveItem(timeline, command)
    case 'move_item':
      assertFrameAligned(command.timeline_start_us, fps)
      return applyMoveItem(timeline, command)
    case 'trim_item':
      assertFrameAligned(command.timeline_us, fps)
      assertFrameAligned(command.source_us, fps)
      return applyTrim(timeline, command)
    case 'split_item':
      assertFrameAligned(command.at_timeline_us, fps)
      assertFrameAligned(command.at_source_us, fps)
      return applySplit(timeline, command)
    case 'ripple_delete':
      return applyRippleDelete(timeline, command, fps)
    case 'add_track':
      return applyAddTrack(timeline, command)
    case 'remove_track':
      return applyRemoveTrack(timeline, command)
    case 'move_track':
      return applyMoveTrack(timeline, command)
    case 'update_track':
      return applyUpdateTrack(timeline, command)
    case 'add_caption_track':
      return applyAddCaptionTrack(timeline, command)
    case 'remove_caption_track':
      return applyRemoveCaptionTrack(timeline, command)
    case 'update_caption_track':
      return applyUpdateCaptionTrack(timeline, command)
    case 'upsert_caption_cues':
      for (const cue of command.cues) {
        assertFrameAligned(cue.start_us, fps)
        assertFrameAligned(cue.end_us, fps)
      }
      return applyUpsertCaptionCues(timeline, command)
    case 'remove_caption_cues':
      return applyRemoveCaptionCues(timeline, command)
    case 'set_item_properties':
      for (const keyframe of command.properties.keyframes ?? [])
        assertFrameAligned(keyframe.time_us, fps)
      return applyProperties(timeline, command)
    case 'set_caption_style':
      return applyCaptionStyle(timeline, command)
    case 'request_job':
      throw new EditEngineError(
        'unsupported_command',
        'request_job must be dispatched through a MediaJobClient host adapter',
        command.command_id,
      )
    default:
      return assertNever(command)
  }
}

function assertNever(value: never): never {
  throw new EditEngineError(
    'unsupported_command',
    `Unsupported command ${(value as { type?: string }).type ?? 'unknown'}`,
  )
}

function validateAndPrepare(timeline: TimelineState, context: EditEngineContext): MutableTimeline {
  try {
    normalizeFrameRate(context.fps)
  } catch (error) {
    throw new EditEngineError(
      'invalid_request',
      error instanceof Error ? error.message : 'fps must be a finite positive rate',
    )
  }
  const valid = validateTimelineState(timeline)
  if (!valid.ok)
    throw new EditEngineError('invalid_request', valid.errors[0]?.message ?? 'timeline is invalid')
  assertFrameAligned(timeline.duration_us, context.fps)
  for (const item of allItems(timeline as MutableTimeline)) {
    assertFrameAligned(itemStart(item), context.fps)
    assertFrameAligned(itemEnd(item), context.fps)
    if (item.item_type === 'clip') {
      assertFrameAligned(item.source_start_us, context.fps)
      assertFrameAligned(item.source_end_us, context.fps)
    }
  }
  return cloneTimeline(timeline)
}

export function applyEditCommands(
  timeline: TimelineState,
  commands: readonly EditCommand[],
  context: EditEngineContext,
): EditEngineResult {
  const next = validateAndPrepare(timeline, context)
  const applied: AppliedCommandResult[] = []
  for (const command of commands) {
    const previousDuration = next.duration_us
    const commandEffect = applyCommand(next, command, context.fps)
    const actualDelta = next.duration_us - previousDuration
    const effect =
      commandEffect.timeline_delta_us === actualDelta
        ? commandEffect
        : { ...commandEffect, timeline_delta_us: actualDelta }
    applied.push({
      command_id: command.command_id,
      command_type: command.type,
      status: 'applied',
      effect,
    })
  }
  const validated = validateTimelineState(next)
  if (!validated.ok)
    throw new EditEngineError(
      'invalid_request',
      validated.errors[0]?.message ?? 'edit produced an invalid timeline',
    )
  return { timeline: next, commands: applied }
}

export const controlledEditEngine: ControlledEditEngine = {
  apply: applyEditCommands,
}
