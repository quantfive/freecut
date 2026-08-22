import {
  DEFAULT_HOST_CAPABILITIES,
  capabilityForCommand,
  isHostCapabilityEnabled,
  type EditorHost,
  type EmbeddedEditorSnapshot,
  type HostEditResult,
  type HostNotice,
  type MediaLocator,
  type ResolvedMediaLocator,
} from './contract'
import {
  createCodePressCommandAdapter,
  MAX_COMMANDS_PER_OPERATION,
  type EditCommand,
  type EditCommandBatch,
  type FreeCutFrameDocument,
  type FreeCutFrameItem,
  type Precondition,
} from '@/features/editor/codepress'
import { framesToMicroseconds, type FrameRateLike } from '@/features/editor/codepress/timing'
import { freeCutDocumentToControlledDocument } from '@/features/editor/codepress/document'
import type { ControlledEditorDocument } from '@/features/editor/codepress/interfaces'
import { hostSnapshotToControlledDocument } from './document'

export type HostControllerResult =
  | HostEditResult
  | {
      status: 'unsupported'
      snapshot: EmbeddedEditorSnapshot
      reason: string
    }

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      // A present-but-undefined key is equivalent to a missing key: host
      // snapshots omit unset optional fields while the native round trip may
      // surface them explicitly.
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function itemMap(
  document: FreeCutFrameDocument,
): Map<string, FreeCutFrameDocument['tracks'][number]['items'][number]> {
  return new Map(
    document.tracks.flatMap((track) => track.items.map((item) => [item.id, item] as const)),
  )
}

type FrameClip = Extract<FreeCutFrameItem, { type: 'video' | 'audio' | 'image' }>

function isFrameClip(item: FreeCutFrameItem): item is FrameClip {
  return item.type === 'video' || item.type === 'audio' || item.type === 'image'
}

function sourceBounds(item: FrameClip): [number, number] {
  const start = item.sourceStart ?? item.from
  return [start, item.sourceEnd ?? start + item.durationInFrames]
}

/**
 * Host snapshots may omit source bounds; the native bridge synthesizes them
 * (sourceStart ?? from, sourceEnd ?? sourceStart + duration).  Fill the same
 * defaults on both sides so an unchanged item compares equal regardless of
 * which side carried the explicit keys.
 */
function withSynthesizedSourceBounds(item: FreeCutFrameItem): FreeCutFrameItem {
  if (!isFrameClip(item)) return item
  const [sourceStart, sourceEnd] = sourceBounds(item)
  return { ...item, sourceStart, sourceEnd }
}

function trackIndex(document: FreeCutFrameDocument, trackId: string): number {
  return Math.max(
    0,
    document.tracks.findIndex((track) => track.id === trackId),
  )
}

function itemLocation(document: FreeCutFrameDocument, itemIdToFind: string) {
  for (const track of document.tracks) {
    const index = track.items.findIndex((item) => item.id === itemIdToFind)
    if (index >= 0) return { track, index }
  }
  return null
}

function preconditionForItem(
  item: FreeCutFrameDocument['tracks'][number]['items'][number],
  fps: FrameRateLike,
): Precondition {
  if (item.type === 'caption_cue') {
    return {
      type: 'caption_cue_at',
      track_id: item.trackId,
      cue_id: item.id,
      start_us: framesToMicroseconds(item.from, fps),
      end_us: framesToMicroseconds(item.from + item.durationInFrames, fps),
      text: item.text,
    }
  }
  return {
    type: 'item_at',
    item_id: item.id,
    track_id: item.trackId,
    timeline_start_us: framesToMicroseconds(item.from, fps),
    timeline_end_us: framesToMicroseconds(item.from + item.durationInFrames, fps),
  }
}

function withoutPosition(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const copy = { ...(item as Record<string, unknown>) }
  delete copy.trackId
  delete copy.from
  delete copy.durationInFrames
  delete copy.sourceStart
  delete copy.sourceEnd
  delete copy.transform
  return copy
}

function firstNumericValue(
  value: Record<string, unknown>,
  keys: readonly string[],
  fallback: number,
): number {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'number') return candidate
  }
  return fallback
}

function normalizedTransform(item: unknown): Record<string, number> | null {
  if (!item || typeof item !== 'object') return null
  const transform = (item as Record<string, unknown>).transform
  if (!transform || typeof transform !== 'object') return null
  const value = transform as Record<string, unknown>
  return {
    x: firstNumericValue(value, ['x', 'position_x'], 0),
    y: firstNumericValue(value, ['y', 'position_y'], 0),
    scaleX: firstNumericValue(value, ['scaleX', 'scale_x'], 1),
    scaleY: firstNumericValue(value, ['scaleY', 'scale_y'], 1),
    rotation: firstNumericValue(value, ['rotation', 'rotation_degrees'], 0),
    anchorX: firstNumericValue(value, ['anchorX', 'anchor_x'], 0),
    anchorY: firstNumericValue(value, ['anchorY', 'anchor_y'], 0),
    opacity: firstNumericValue(value, ['opacity'], 1),
  }
}

function transformsEquivalent(left: unknown, right: unknown): boolean {
  return stableSerialize(normalizedTransform(left)) === stableSerialize(normalizedTransform(right))
}

function positionOnly(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const value = item as Record<string, unknown>
  return {
    trackId: value.trackId,
    from: value.from,
    durationInFrames: value.durationInFrames,
    sourceStart: value.sourceStart,
    sourceEnd: value.sourceEnd,
  }
}

function commandItemFromDocument(
  document: FreeCutFrameDocument,
  id: string,
): Extract<EditCommand, { type: 'add_clip' | 'add_text' }>['item'] | null {
  const item = itemMap(document).get(id)
  if (!item || item.type === 'caption_cue') return null
  const controlled = freeCutDocumentToControlledDocument(document).timeline
  const located = controlled.tracks
    .flatMap((track) => track.items)
    .find((candidate) => candidate.item_type !== 'caption_cue' && candidate.item_id === id)
  if (!located || (located.item_type !== 'clip' && located.item_type !== 'text')) return null
  return located
}

function splitLeftId(originalId: string): string {
  const suffix = ':left'
  return `${originalId.slice(0, Math.max(1, 128 - suffix.length))}${suffix}`
}

function commandIdsForChanges(
  previous: FreeCutFrameDocument,
  next: FreeCutFrameDocument,
): {
  added: string[]
  removed: string[]
  changed: string[]
} {
  const previousItems = itemMap(previous)
  const nextItems = itemMap(next)
  const added = [...nextItems.keys()].filter((id) => !previousItems.has(id))
  const removed = [...previousItems.keys()].filter((id) => !nextItems.has(id))
  const changed = [...nextItems.keys()].filter((id) => {
    const before = previousItems.get(id)
    const after = nextItems.get(id)
    return (
      before !== undefined &&
      after !== undefined &&
      stableSerialize(withSynthesizedSourceBounds(before)) !==
        stableSerialize(withSynthesizedSourceBounds(after))
    )
  })
  return { added, removed, changed }
}

export interface DerivedHostEdit {
  batch: EditCommandBatch | null
  reason?: string
}

/**
 * Derive one bounded command batch from the real editor's frame-native store
 * change.  Ambiguous or unsupported changes fail closed instead of being
 * silently ignored or written to local persistence.
 */
// fallow-ignore-next-line complexity
export function deriveSupportedHostEdit(
  previous: FreeCutFrameDocument,
  next: FreeCutFrameDocument,
  options: { operationId?: string; idempotencyKey?: string } = {},
): DerivedHostEdit {
  const { added, removed, changed } = commandIdsForChanges(previous, next)
  const previousItems = itemMap(previous)
  const nextItems = itemMap(next)
  const fps = previous.fps
  const operationId = options.operationId ?? `op-${crypto.randomUUID()}`
  const idempotencyKey = options.idempotencyKey ?? `idem-${crypto.randomUUID()}`
  const commands: EditCommand[] = []
  const preconditions: Precondition[] = []
  const previousTrackIds = new Set(previous.tracks.map((track) => track.id))
  const addedTracks = next.tracks.filter((track) => !previousTrackIds.has(track.id))

  for (const track of addedTracks) {
    commands.push({
      command_id: `add-track-${track.id}`,
      type: 'add_track',
      track: {
        track_id: track.id,
        kind: track.kind,
        name: track.name,
        locked: track.locked,
        muted: track.muted,
        items: [],
      },
      index: trackIndex(next, track.id),
    })
    preconditions.push({ type: 'track_absent', track_id: track.id })
  }

  if (
    addedTracks.length > 0 &&
    removed.length === 0 &&
    added.length === 0 &&
    changed.length === 0
  ) {
    // Track creation is already represented by the add_track commands above.
  } else if (removed.length >= 1 && added.length === 0 && changed.length === 0) {
    const removedItems = removed.map((id) => previousItems.get(id)!)
    if (removedItems.some((item) => item.type === 'caption_cue'))
      return { batch: null, reason: 'Caption removal is not supported' }
    if (commands.length + removedItems.length > MAX_COMMANDS_PER_OPERATION) {
      return {
        batch: null,
        reason: `Removing ${removedItems.length} items exceeds the ${MAX_COMMANDS_PER_OPERATION}-command host operation limit`,
      }
    }
    for (const before of removedItems) {
      commands.push({
        command_id: `remove-${before.id}`,
        type: 'remove_item',
        item_id: before.id,
      })
      preconditions.push(preconditionForItem(before, fps))
    }
  } else if (added.length === 1 && removed.length === 0 && changed.length === 0) {
    const id = added[0]!
    const after = nextItems.get(id)!
    const location = itemLocation(next, id)
    const item = commandItemFromDocument(next, id)
    if (!location || !item)
      return { batch: null, reason: 'The added item is not a supported clip or text item' }
    if (after.type === 'caption_cue')
      return { batch: null, reason: 'Caption insertion is not supported' }
    commands.push({
      command_id: `add-${id}`,
      type: after.type === 'text' ? 'add_text' : 'add_clip',
      track_id: after.trackId,
      item,
      index: location.index,
    } as EditCommand)
    if (!addedTracks.some((track) => track.id === after.trackId)) {
      preconditions.push({ type: 'track_exists', track_id: after.trackId })
    }
    preconditions.push({ type: 'item_absent', item_id: id })
  } else if (added.length === 1 && removed.length === 0 && changed.length === 1) {
    const leftId = changed[0]!
    const rightId = added[0]!
    const before = previousItems.get(leftId)
    const left = nextItems.get(leftId)
    const right = nextItems.get(rightId)
    if (
      !before ||
      !left ||
      !right ||
      !isFrameClip(before) ||
      !isFrameClip(left) ||
      !isFrameClip(right)
    ) {
      return { batch: null, reason: 'The split change is not a supported clip or text item' }
    }
    const splitMatches =
      left.trackId === right.trackId &&
      left.from === before.from &&
      left.from + left.durationInFrames === right.from &&
      right.from + right.durationInFrames === before.from + before.durationInFrames &&
      stableSerialize(withoutPosition(before)) === stableSerialize(withoutPosition(left)) &&
      transformsEquivalent(before, left) &&
      stableSerialize(positionOnly(before)) !== stableSerialize(positionOnly(left))
    if (!splitMatches) return { batch: null, reason: 'The timeline change is ambiguous' }
    const [splitSource] = sourceBounds(right)
    commands.push({
      command_id: `split-${leftId}`,
      type: 'split_item',
      item_id: leftId,
      at_timeline_us: framesToMicroseconds(right.from, fps),
      at_source_us: framesToMicroseconds(splitSource, fps),
      left_item_id: splitLeftId(leftId),
      right_item_id: rightId,
    })
    preconditions.push(preconditionForItem(before, fps))
  } else if (removed.length === 0 && added.length === 0 && changed.length === 1) {
    const id = changed[0]!
    const before = previousItems.get(id)!
    const after = nextItems.get(id)!
    if (before.type === 'caption_cue' || after.type === 'caption_cue') {
      return { batch: null, reason: 'Caption edits are not supported in the first host slice' }
    }
    const metadataUnchanged =
      stableSerialize(withoutPosition(before)) === stableSerialize(withoutPosition(after))
    const transformUnchanged = transformsEquivalent(before, after)
    const sourceUnchanged =
      isFrameClip(before) && isFrameClip(after)
        ? sourceBounds(before)[0] === sourceBounds(after)[0] &&
          sourceBounds(before)[1] === sourceBounds(after)[1]
        : before.type === after.type
    const timelineUnchanged =
      before.from === after.from && before.durationInFrames === after.durationInFrames
    const onlyPositionChanged =
      metadataUnchanged && transformUnchanged && sourceUnchanged && !timelineUnchanged
    const onlyTrimChanged =
      metadataUnchanged &&
      transformUnchanged &&
      before.trackId === after.trackId &&
      !sourceUnchanged
    const location = itemLocation(next, id)
    if (!location) return { batch: null, reason: 'The changed item no longer has a track' }

    if (onlyPositionChanged) {
      commands.push({
        command_id: `move-${id}`,
        type: 'move_item',
        item_id: id,
        to_track_id: after.trackId,
        timeline_start_us: framesToMicroseconds(after.from, fps),
        index: location.index,
      })
      preconditions.push(preconditionForItem(before, fps))
    } else if (onlyTrimChanged) {
      const edge = after.from !== before.from ? 'start' : 'end'
      const timelineFrame = edge === 'start' ? after.from : after.from + after.durationInFrames
      if (!isFrameClip(after)) {
        return { batch: null, reason: 'Text trimming is not supported in the first host slice' }
      }
      const [, afterSourceEnd] = sourceBounds(after)
      const [afterSourceStart] = sourceBounds(after)
      const sourceFrame = edge === 'start' ? afterSourceStart : afterSourceEnd
      commands.push({
        command_id: `trim-${id}`,
        type: 'trim_item',
        item_id: id,
        edge,
        timeline_us: framesToMicroseconds(timelineFrame, fps),
        source_us: framesToMicroseconds(sourceFrame, fps),
      })
      preconditions.push(preconditionForItem(before, fps))
    } else {
      return {
        batch: null,
        reason: 'Property, effect, or animation edits are unsupported by the host slice',
      }
    }
  } else {
    return { batch: null, reason: 'Multiple or ambiguous timeline changes are unsupported' }
  }

  if (commands.length === 0) return { batch: null, reason: 'No supported edit was detected' }
  return {
    batch: {
      contract_version: 1,
      timeline_id: previous.timelineId,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      base_revision: previous.revision,
      preconditions,
      commands,
    },
  }
}

export class HostEditorController {
  private snapshot: EmbeddedEditorSnapshot
  private readonly host: EditorHost
  private readonly capabilities
  private readonly adapter
  private readonly listeners = new Set<(snapshot: EmbeddedEditorSnapshot) => void>()

  constructor(host: EditorHost, snapshot: EmbeddedEditorSnapshot) {
    this.host = host
    this.capabilities = { ...DEFAULT_HOST_CAPABILITIES, ...host.capabilities }
    this.snapshot = clone(snapshot)
    const document = hostSnapshotToControlledDocument(snapshot)
    this.adapter = createCodePressCommandAdapter({ document })
  }

  getSnapshot(): EmbeddedEditorSnapshot {
    return clone(this.snapshot)
  }

  getDocument(): ControlledEditorDocument {
    return this.adapter.getDocument()
  }

  subscribe(listener: (snapshot: EmbeddedEditorSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  replaceAuthoritativeSnapshot(snapshot: EmbeddedEditorSnapshot): void {
    this.snapshot = clone(snapshot)
    this.adapter.replaceDocument(hostSnapshotToControlledDocument(snapshot))
    for (const listener of this.listeners) {
      listener(this.getSnapshot())
    }
  }

  async resolveMedia(locator: MediaLocator): Promise<ResolvedMediaLocator | null> {
    if (!isHostCapabilityEnabled(this.capabilities, 'media.resolve')) return null
    return this.host.resolveMedia(locator)
  }

  async submitEdit(batch: EditCommandBatch): Promise<HostControllerResult> {
    const unsupported = batch.commands.find((command) => {
      const capability = capabilityForCommand(command.type)
      return !capability || !isHostCapabilityEnabled(this.capabilities, capability)
    })
    if (unsupported) {
      const reason = `The host does not support ${unsupported.type}`
      this.notify({ kind: 'unsupported', message: reason, operationId: batch.operation_id })
      return { status: 'unsupported', snapshot: this.getSnapshot(), reason }
    }

    const localResult = this.adapter.apply(batch)
    if (localResult.status === 'rejected') {
      this.notify({
        kind: 'error',
        message: localResult.error.message,
        operationId: batch.operation_id,
      })
      return { status: 'rejected', snapshot: this.getSnapshot(), result: localResult }
    }

    const remoteResult = await this.host.submitEdit(batch)
    this.replaceAuthoritativeSnapshot(remoteResult.snapshot)
    if (remoteResult.status === 'conflict') {
      this.notify({
        kind: 'conflict',
        message: remoteResult.result.error.message,
        operationId: batch.operation_id,
      })
    }
    return remoteResult
  }

  private notify(notice: HostNotice): void {
    this.host.notify?.(notice)
  }
}
