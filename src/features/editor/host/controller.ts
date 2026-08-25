import {
  DEFAULT_HOST_CAPABILITIES,
  capabilityForCommand,
  isHostCapabilityEnabled,
  type EditorHost,
  type EmbeddedEditorSnapshot,
  type HostEditPredicate,
  type HostEditRejectionDetail,
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

/**
 * The concrete source window of a clip that states none: a clip with no
 * source range plays from the start of its media for its timeline duration.
 * Only use this where a concrete frame is required — representation matching
 * and command payloads.  Never use it to decide whether the source range
 * *changed*; see `sourceBoundUnchanged`.
 *
 * The default is 0, never `item.from`.  A bound derived from the timeline
 * position moves with the clip, which made a plain drag look like a
 * source-range edit here and made the bridge render the wrong media frames.
 */
function sourceBounds(item: FrameClip): [number, number] {
  const start = item.sourceStart ?? 0
  return [start, item.sourceEnd ?? start + item.durationInFrames]
}

/**
 * A source bound only counts as changed when both sides state it.  An absent
 * bound is unknown, not "the timeline position": deriving it from `from` makes
 * every move look like a source-range change, which rules out `move_item` on a
 * cross-track drag and — worse — classifies a same-track drag as `trim_item`.
 */
function sourceBoundUnchanged(before: number | undefined, after: number | undefined): boolean {
  return before === undefined || after === undefined || before === after
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

/**
 * Everything except position, source range, and transform.  `opacity` is
 * dropped with `transform` because the native bridge carries an otherwise
 * identity transform as a top-level `opacity` field; `normalizedTransform`
 * reads both carriers, so a real opacity edit is still caught there.
 */
function withoutPosition(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const copy = { ...(item as Record<string, unknown>) }
  delete copy.trackId
  delete copy.from
  delete copy.durationInFrames
  delete copy.sourceStart
  delete copy.sourceEnd
  delete copy.transform
  delete copy.opacity
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

/**
 * Every item is normalized to the same transform shape, so an item that
 * carries no `transform` key compares equal to one carrying the identity
 * transform.  A host snapshot omits `transform` for a plain clip while the
 * native round trip may materialize one (and vice versa); without this, the
 * first drag of a plain clip fails both the move and the trim predicate.
 *
 * Opacity is read from `transform.opacity` or the item's top-level `opacity`,
 * because the native bridge collapses an otherwise-identity transform into the
 * latter.  A genuinely non-identity transform still compares as different.
 */
function normalizedTransform(item: unknown): Record<string, number> {
  const owner: Record<string, unknown> =
    item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
  const transform = owner.transform
  const value =
    transform && typeof transform === 'object' ? (transform as Record<string, unknown>) : {}
  return {
    x: firstNumericValue(value, ['x', 'position_x'], 0),
    y: firstNumericValue(value, ['y', 'position_y'], 0),
    scaleX: firstNumericValue(value, ['scaleX', 'scale_x'], 1),
    scaleY: firstNumericValue(value, ['scaleY', 'scale_y'], 1),
    rotation: firstNumericValue(value, ['rotation', 'rotation_degrees'], 0),
    anchorX: firstNumericValue(value, ['anchorX', 'anchor_x'], 0),
    anchorY: firstNumericValue(value, ['anchorY', 'anchor_y'], 0),
    // 0 is the bridge's "unset" size on both sides (`nativeTransformToFrame`
    // fills an absent width/height with it), so an absent transform still
    // compares equal to an identity one.  Omitting these here would make a
    // gizmo resize normalize away to nothing, and since the change detector
    // now shares this normalization that resize would be silently kept local
    // instead of being rejected by name.
    width: firstNumericValue(value, ['width'], 0),
    height: firstNumericValue(value, ['height'], 0),
    opacity: firstNumericValue(value, ['opacity'], firstNumericValue(owner, ['opacity'], 1)),
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

/** Field names, never values, that differ between two plain objects. */
function differingKeys(before: unknown, after: unknown): string[] {
  const left = before && typeof before === 'object' ? (before as Record<string, unknown>) : {}
  const right = after && typeof after === 'object' ? (after as Record<string, unknown>) : {}
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => stableSerialize(left[key]) !== stableSerialize(right[key]))
    .sort()
}

/** Keep both the notice payload and the toast bounded. */
const MAX_DETAIL_FIELDS = 24
const MAX_MESSAGE_FIELDS = 6

function describeFields(fields: readonly string[], limit: number): string {
  if (fields.length <= limit) return fields.join(', ')
  return `${fields.slice(0, limit).join(', ')} +${fields.length - limit} more`
}

/**
 * Turn a structured rejection into the trailing clause of the user-facing
 * reason.  The leading sentence is unchanged; only predicate and field *names*
 * are appended, so a support person can tell the causes apart from a
 * screenshot without any item content leaking into the toast.
 */
function describeRejection(detail: HostEditRejectionDetail): string {
  const parts: string[] = []
  if (detail.failedPredicates?.length) parts.push(`mismatch: ${detail.failedPredicates.join(', ')}`)
  if (detail.changedFields?.length) {
    parts.push(`fields: ${describeFields(detail.changedFields, MAX_MESSAGE_FIELDS)}`)
  }
  if (detail.changeCounts) {
    const { added, removed, changed } = detail.changeCounts
    parts.push(`added ${added}, removed ${removed}, changed ${changed}`)
  }
  return parts.length > 0 ? ` (${parts.join('; ')})` : ''
}

function sourceBoundOf(
  item: FreeCutFrameItem,
  key: 'sourceStart' | 'sourceEnd',
): number | undefined {
  return isFrameClip(item) ? item[key] : undefined
}

/** The field names a single failed predicate is about.  Names, never values. */
function fieldsForPredicate(
  predicate: HostEditPredicate,
  before: FreeCutFrameItem,
  after: FreeCutFrameItem,
): string[] {
  switch (predicate) {
    case 'metadata':
      return differingKeys(withoutPosition(before), withoutPosition(after))
    case 'transform':
      return differingKeys(normalizedTransform(before), normalizedTransform(after)).map(
        (key) => `transform.${key}`,
      )
    case 'sourceRange':
      return (['sourceStart', 'sourceEnd'] as const).filter(
        (key) => !sourceBoundUnchanged(sourceBoundOf(before, key), sourceBoundOf(after, key)),
      )
    case 'track':
      return ['trackId']
    // `timelinePosition` fails because nothing moved, so it names no field.
    default:
      return []
  }
}

function itemChangeRejectionDetail(
  before: FreeCutFrameItem,
  after: FreeCutFrameItem,
  failedPredicates: readonly HostEditPredicate[],
): HostEditRejectionDetail {
  const fields = new Set(
    failedPredicates.flatMap((predicate) => fieldsForPredicate(predicate, before, after)),
  )
  return {
    code: 'unclassified_item_change',
    itemId: before.id,
    failedPredicates,
    changedFields: [...fields].slice(0, MAX_DETAIL_FIELDS),
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

/**
 * Every pairwise fact the classifier decides an item change from.  This is the
 * *only* place two versions of an item are compared: `commandIdsForChanges`
 * enrols an item as changed exactly when one of these facts says it changed,
 * and the classifier below routes on the same object.
 *
 * The single definition is the point.  A second comparison — a whole-item
 * serialization, say — drifts out of step the moment a normalization is added
 * here, and it has, twice: an absent transform reading as an identity one, and
 * an absent source bound reading as unknown.  An item that the detector calls
 * changed but every predicate calls unchanged reaches the classifier with no
 * branch to take, and falls through to a rejection naming no actionable field.
 */
interface ItemChangeFacts {
  metadataUnchanged: boolean
  transformUnchanged: boolean
  sourceUnchanged: boolean
  durationUnchanged: boolean
  timelineUnchanged: boolean
  sameTrack: boolean
}

function itemChangeFacts(before: FreeCutFrameItem, after: FreeCutFrameItem): ItemChangeFacts {
  const durationUnchanged = before.durationInFrames === after.durationInFrames
  return {
    metadataUnchanged:
      stableSerialize(withoutPosition(before)) === stableSerialize(withoutPosition(after)),
    transformUnchanged: transformsEquivalent(before, after),
    sourceUnchanged:
      isFrameClip(before) && isFrameClip(after)
        ? sourceBoundUnchanged(before.sourceStart, after.sourceStart) &&
          sourceBoundUnchanged(before.sourceEnd, after.sourceEnd)
        : before.type === after.type,
    durationUnchanged,
    timelineUnchanged: before.from === after.from && durationUnchanged,
    sameTrack: before.trackId === after.trackId,
  }
}

/**
 * The one definition of "this item changed": any fact that says so.  Duration
 * is covered by `timelineUnchanged`, which is the conjunction of position and
 * duration.
 */
function itemChanged(facts: ItemChangeFacts): boolean {
  return !(
    facts.metadataUnchanged &&
    facts.transformUnchanged &&
    facts.sourceUnchanged &&
    facts.timelineUnchanged &&
    facts.sameTrack
  )
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
      before !== undefined && after !== undefined && itemChanged(itemChangeFacts(before, after))
    )
  })
  return { added, removed, changed }
}

/**
 * The reason that means "this diff is not an edit at all".  The runtime
 * branches on this exact value to stay silent — no command, no notice, and no
 * restoration of the authoritative snapshot — so it is a binding between two
 * modules, not a message.  Every no-op reconcile now travels this path,
 * including the ones a playback scroll triggers, so an inlined copy that
 * drifts by a character would silently reinstate the rejection this exists to
 * prevent, with nothing failing to say so.  Import it; never respell it.
 */
export const NO_SUPPORTED_EDIT_REASON = 'No supported edit was detected'

export interface DerivedHostEdit {
  batch: EditCommandBatch | null
  reason?: string
  /** Value-free diagnostics for a rejection, forwarded on the host notice. */
  detail?: HostEditRejectionDetail
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

  if (removed.length === 0 && added.length === 0 && changed.length === 0) {
    // Any track creation is already represented by the add_track commands
    // above.  With no tracks added either, nothing changed at all: `commands`
    // stays empty and the caller gets the silent "No supported edit was
    // detected" sentinel below, which emits no command and leaves the host
    // snapshot alone.  A reconcile is triggered by any timeline-store write,
    // view-only state included — playback's page-following persists a scroll
    // position — so a no-op diff must never surface as a user-visible
    // rejection.
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
    const {
      metadataUnchanged,
      transformUnchanged,
      sourceUnchanged,
      durationUnchanged,
      timelineUnchanged,
      sameTrack,
    } = itemChangeFacts(before, after)
    // A move never changes the duration, and a trim always does *something*
    // to the source window — either an explicit bound or the duration that
    // stands in for one when the host states no bounds at all.
    const onlyPositionChanged =
      metadataUnchanged &&
      transformUnchanged &&
      sourceUnchanged &&
      durationUnchanged &&
      !timelineUnchanged
    const onlyTrimChanged =
      metadataUnchanged &&
      transformUnchanged &&
      sameTrack &&
      (!sourceUnchanged || !durationUnchanged)
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
      const failedPredicates: HostEditPredicate[] = []
      if (!metadataUnchanged) failedPredicates.push('metadata')
      if (!transformUnchanged) failedPredicates.push('transform')
      if (!sourceUnchanged) failedPredicates.push('sourceRange')
      if (!sameTrack) failedPredicates.push('track')
      if (timelineUnchanged) failedPredicates.push('timelinePosition')
      const detail = itemChangeRejectionDetail(before, after, failedPredicates)
      return {
        batch: null,
        reason: `Property, effect, or animation edits are unsupported by the host slice${describeRejection(detail)}`,
        detail,
      }
    }
  } else {
    const detail: HostEditRejectionDetail = {
      code: 'ambiguous_change',
      changeCounts: { added: added.length, removed: removed.length, changed: changed.length },
    }
    return {
      batch: null,
      reason: `Multiple or ambiguous timeline changes are unsupported${describeRejection(detail)}`,
      detail,
    }
  }

  if (commands.length === 0) return { batch: null, reason: NO_SUPPORTED_EDIT_REASON }
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
