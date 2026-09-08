import type { TimelineItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import { expandIdsWithLinkedItems, getLinkedItemsForEdit } from '../linked-edit'
import {
  sourceSecondsToTimelineFrame,
  getItemSourceSpanSeconds,
} from '../../../utils/media-item-frames'
import { getUniqueLinkedItemAnchorIds } from '../../../utils/linked-items'
import { isTrackSyncLockEnabled } from '../../../utils/track-sync-lock'
import {
  buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
  propagateRemovedIntervalsToSyncLockedTracks,
} from '../sync-lock-ripple'
import { applySplitBookkeeping, type SplitResultEntry } from '../split-bookkeeping'
import {
  canMutateTimelineItems,
  isLinkedSelectionEnabled,
  isInTransitionOverlap,
  requestPostEditWarmForItems,
} from './shared'

export interface RemoveSilenceRange {
  start: number
  end: number
}

export interface RemoveSilenceResult {
  analyzedItemCount: number
  removedRangeCount: number
  removedItemCount: number
  splitCount: number
}

// A post-split segment is removed when at least this fraction of its source-time
// span is covered by detected silence. The threshold guards two cases:
//   1. Frames that couldn't be split cleanly (e.g. inside a transition overlap)
//      leave a partial segment whose start/end still bracket loud audio — we
//      keep those so users don't lose speech to the silence cutter.
//   2. Floating-point rounding when converting source seconds → timeline frames
//      can leave a few frames of audible content on either side of a "fully
//      silent" segment — 0.75 is permissive enough to remove those anyway.
const SILENCE_COVERAGE_REMOVAL_THRESHOLD = 0.75

function isMostlyInsideRanges(
  span: { start: number; end: number },
  ranges: readonly RemoveSilenceRange[],
): boolean {
  const duration = span.end - span.start
  if (duration <= 0) return false

  const covered = ranges.reduce((sum, range) => {
    const overlapStart = Math.max(span.start, range.start)
    const overlapEnd = Math.min(span.end, range.end)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)

  return covered / duration >= SILENCE_COVERAGE_REMOVAL_THRESHOLD
}

function applyRippleRemoval(
  ids: string[],
  forceLinked = false,
): { removedIds: string[]; affectedIds: string[] } {
  const items = useItemsStore.getState().items
  const linkedSelectionEnabled = forceLinked || isLinkedSelectionEnabled()
  const expandedIds = expandIdsWithLinkedItems(items, ids, linkedSelectionEnabled)
  if (expandedIds.length === 0) return { removedIds: [], affectedIds: [] }

  const idsToDelete = new Set(expandedIds)
  const remainingItems = items.filter((item) => !idsToDelete.has(item.id))
  const baseShiftByItemId = new Map<string, number>()
  const editedTrackIds = new Set(
    items.filter((item) => idsToDelete.has(item.id)).map((item) => item.trackId),
  )
  const removedIntervals = items
    .filter((item) => idsToDelete.has(item.id))
    .map((item) => ({
      start: item.from,
      end: item.from + item.durationInFrames,
    }))

  for (const item of remainingItems) {
    const shiftAmount = items
      .filter((candidate) => idsToDelete.has(candidate.id))
      .filter(
        (deletedItem) =>
          deletedItem.trackId === item.trackId &&
          deletedItem.from + deletedItem.durationInFrames <= item.from,
      )
      .reduce((sum, deletedItem) => sum + deletedItem.durationInFrames, 0)

    if (shiftAmount > 0) {
      baseShiftByItemId.set(item.id, shiftAmount)
    }
  }

  const trackById = new Map(useItemsStore.getState().tracks.map((track) => [track.id, track]))
  const itemById = new Map(remainingItems.map((item) => [item.id, item]))
  const shiftByItemId = new Map<string, number>()

  for (const [itemId, shiftAmount] of baseShiftByItemId) {
    if (shiftAmount <= 0) continue

    const relatedIds = expandIdsWithLinkedItems(remainingItems, [itemId], linkedSelectionEnabled)
    for (const relatedId of relatedIds) {
      const relatedItem = itemById.get(relatedId)
      if (!relatedItem) continue

      const handledBySyncLock =
        !editedTrackIds.has(relatedItem.trackId) &&
        isTrackSyncLockEnabled(trackById.get(relatedItem.trackId))
      if (handledBySyncLock) continue

      shiftByItemId.set(relatedId, Math.max(shiftByItemId.get(relatedId) ?? 0, shiftAmount))
    }
  }

  const updates = remainingItems.flatMap((item) => {
    const shiftAmount = shiftByItemId.get(item.id) ?? 0
    return shiftAmount > 0 ? [{ id: item.id, from: item.from - shiftAmount }] : []
  })

  const shiftedById = new Map(updates.map((update) => [update.id, update.from]))
  const coveredIds: string[] = []
  for (const item of remainingItems) {
    if (shiftedById.has(item.id)) continue
    const itemEnd = item.from + item.durationInFrames
    for (const other of remainingItems) {
      const newFrom = shiftedById.get(other.id)
      if (newFrom === undefined || other.trackId !== item.trackId) continue
      const newEnd = newFrom + other.durationInFrames
      if (newFrom < itemEnd && newEnd > item.from) {
        coveredIds.push(item.id)
        break
      }
    }
  }

  const expandedCoveredIds = expandIdsWithLinkedItems(
    remainingItems,
    coveredIds,
    linkedSelectionEnabled,
  )
  const allRemoveIds = [...expandedIds, ...expandedCoveredIds]
  const coveredSet = new Set(expandedCoveredIds)
  const filteredUpdates =
    coveredSet.size > 0 ? updates.filter((update) => !coveredSet.has(update.id)) : updates

  const store = useItemsStore.getState()
  store._removeItems(allRemoveIds)
  if (filteredUpdates.length > 0) {
    store._moveItems(filteredUpdates)
  }

  const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
    editedTrackIds,
    intervals: removedIntervals,
    additionalAffectedIds: new Set([
      ...allRemoveIds,
      ...filteredUpdates.map((update) => update.id),
    ]),
  })

  const cascadedRemoveIds = Array.from(new Set([...allRemoveIds, ...syncLockResult.removedIds]))
  useTransitionsStore.getState()._removeTransitionsForItems(cascadedRemoveIds)
  useKeyframesStore.getState()._removeKeyframesForItems(cascadedRemoveIds)

  if (filteredUpdates.length > 0) {
    applyTransitionRepairs(filteredUpdates.map((update) => update.id))
  }

  const repairedClipIds = Array.from(
    new Set([...updates.map((update) => update.id), ...syncLockResult.affectedIds]),
  )
  if (repairedClipIds.length > 0) {
    applyTransitionRepairs(repairedClipIds, new Set(cascadedRemoveIds))
  }

  return {
    removedIds: cascadedRemoveIds,
    affectedIds: Array.from(new Set([...repairedClipIds, ...filteredUpdates.map((u) => u.id)])),
  }
}

export function removeSilenceFromItems(
  itemIds: string[],
  silenceRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  return removeTimelineRangesFromItems('REMOVE_SILENCE', itemIds, silenceRangesByMediaId)
}

export function removeFillerWordsFromItems(
  itemIds: string[],
  fillerRangesByMediaId: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  return removeTimelineRangesFromItems('REMOVE_FILLER_WORDS', itemIds, fillerRangesByMediaId)
}

/**
 * Remove the source-time ranges a user selected in the transcript editor.
 * Ranges are in source-native seconds, keyed by mediaId — the same shape the
 * silence/filler removers use — so this reuses the split-then-ripple machinery
 * and lands as a single "remove transcript selection" undo step.
 */
export function removeTranscriptRangesFromItems(
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
  rangesByItemId?: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  return removeTimelineRangesFromItems(
    'REMOVE_TRANSCRIPT_SELECTION',
    itemIds,
    rangesByMediaId,
    rangesByItemId,
  )
}

function getRangeRemovalAnchors(
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
  rangesByItemId?: Record<string, RemoveSilenceRange[]>,
): TimelineItem[] {
  const store = useItemsStore.getState()
  const anchorIds = getUniqueLinkedItemAnchorIds(store.items, itemIds)
  return anchorIds
    .map((id) => store.itemById[id])
    .filter(
      (item): item is TimelineItem =>
        item !== undefined &&
        (item.type === 'video' || item.type === 'audio') &&
        !!item.mediaId &&
        ((rangesByItemId ? rangesByItemId[item.id] : rangesByMediaId[item.mediaId])?.length ?? 0) >
          0,
    )
}

function getAnchorTimelineIntervals(
  anchor: TimelineItem,
  ranges: RemoveSilenceRange[],
  timelineFps: number,
): RemoveSilenceRange[] {
  return ranges.flatMap((range) => {
    const firstFrame = sourceSecondsToTimelineFrame(anchor, range.start, timelineFps)
    const secondFrame = sourceSecondsToTimelineFrame(anchor, range.end, timelineFps)
    const start = Math.max(anchor.from, Math.min(firstFrame, secondFrame))
    const end = Math.min(anchor.from + anchor.durationInFrames, Math.max(firstFrame, secondFrame))
    return end > start ? [{ start, end }] : []
  })
}

interface RangeRemovalPreflightAccumulator {
  mutationIds: Set<string>
  editedTrackIds: Set<string>
  earliestAffectedFrameByTrackId: Map<string, number>
  intervals: RemoveSilenceRange[]
}

function addRangeAnchorPreflight(params: {
  anchor: TimelineItem
  ranges: RemoveSilenceRange[]
  timelineFps: number
  linkedSelectionEnabled: boolean
  accumulator: RangeRemovalPreflightAccumulator
}): void {
  const items = useItemsStore.getState().items
  const splitItems = getLinkedItemsForEdit(items, params.anchor.id, params.linkedSelectionEnabled)
  const anchorIntervals = getAnchorTimelineIntervals(
    params.anchor,
    params.ranges,
    params.timelineFps,
  )
  params.accumulator.intervals.push(...anchorIntervals)

  for (const splitItem of splitItems) {
    params.accumulator.editedTrackIds.add(splitItem.trackId)
    for (const relatedId of expandIdsWithLinkedItems(
      items,
      [splitItem.id],
      params.linkedSelectionEnabled,
    )) {
      params.accumulator.mutationIds.add(relatedId)
    }

    for (const interval of anchorIntervals) {
      const previousStart =
        params.accumulator.earliestAffectedFrameByTrackId.get(splitItem.trackId) ??
        Number.POSITIVE_INFINITY
      params.accumulator.earliestAffectedFrameByTrackId.set(
        splitItem.trackId,
        Math.min(previousStart, interval.start),
      )
    }
  }
}

function addRangeDownstreamPreflight(params: {
  items: TimelineItem[]
  linkedSelectionEnabled: boolean
  accumulator: RangeRemovalPreflightAccumulator
}): void {
  for (const item of params.items) {
    const earliestAffectedFrame = params.accumulator.earliestAffectedFrameByTrackId.get(
      item.trackId,
    )
    if (
      earliestAffectedFrame === undefined ||
      item.from + item.durationInFrames <= earliestAffectedFrame
    ) {
      continue
    }
    for (const relatedId of expandIdsWithLinkedItems(
      params.items,
      [item.id],
      params.linkedSelectionEnabled,
    )) {
      params.accumulator.mutationIds.add(relatedId)
    }
  }
}

function buildRangeRemovalPreflight(
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
  rangesByItemId?: Record<string, RemoveSilenceRange[]>,
): { analyzedItemCount: number; mutationIds: string[] } {
  const store = useItemsStore.getState()
  const timelineFps = useTimelineSettingsStore.getState().fps
  const anchors = getRangeRemovalAnchors(itemIds, rangesByMediaId, rangesByItemId)
  if (anchors.length === 0) return { analyzedItemCount: 0, mutationIds: [] }

  const linkedSelectionEnabled = !!rangesByItemId || isLinkedSelectionEnabled()
  const accumulator: RangeRemovalPreflightAccumulator = {
    mutationIds: new Set<string>(),
    editedTrackIds: new Set<string>(),
    earliestAffectedFrameByTrackId: new Map<string, number>(),
    intervals: [],
  }

  for (const anchor of anchors) {
    addRangeAnchorPreflight({
      anchor,
      ranges: (rangesByItemId ? rangesByItemId[anchor.id] : rangesByMediaId[anchor.mediaId!]) ?? [],
      timelineFps,
      linkedSelectionEnabled,
      accumulator,
    })
  }

  addRangeDownstreamPreflight({ items: store.items, linkedSelectionEnabled, accumulator })

  const syncLockUpdates = buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
    items: store.items,
    tracks: store.tracks,
    editedTrackIds: accumulator.editedTrackIds,
    intervals: accumulator.intervals,
    additionalAffectedIds: accumulator.mutationIds,
  })
  for (const update of syncLockUpdates) accumulator.mutationIds.add(update.id)

  return { analyzedItemCount: anchors.length, mutationIds: Array.from(accumulator.mutationIds) }
}

function assertTranscriptSplitOutsideTransition(item: TimelineItem, frame: number): void {
  if (frame <= item.from || frame >= item.from + item.durationInFrames) return
  if (isInTransitionOverlap(item.id, frame - item.from, item.durationInFrames)) {
    throw new Error('The selected word crosses a transition. Adjust the transition before cutting.')
  }
}

function transcriptOccurrenceTiming(item: TimelineItem, fps: number) {
  const span = getItemSourceSpanSeconds(item, fps)
  return [
    item.mediaId,
    item.from,
    item.durationInFrames,
    item.speed ?? 1,
    !!item.isReversed,
    span?.start,
    span?.end,
  ] as const
}

function assertTranscriptLinkedCohort(anchor: TimelineItem, linkedItems: TimelineItem[]): void {
  const fps = useTimelineSettingsStore.getState().fps
  const anchorTiming = transcriptOccurrenceTiming(anchor, fps)
  const synchronized = linkedItems.every((item) =>
    transcriptOccurrenceTiming(item, fps).every((value, index) => value === anchorTiming[index]),
  )
  if (!synchronized) {
    throw new Error('Linked clips have different trims or timing. Align them before cutting words.')
  }
}

function assertTranscriptRangesRepresentable(
  anchor: TimelineItem,
  ranges: RemoveSilenceRange[],
): void {
  const fps = useTimelineSettingsStore.getState().fps
  const linkedItems = getLinkedItemsForEdit(useItemsStore.getState().items, anchor.id, true)
  assertTranscriptLinkedCohort(anchor, linkedItems)
  for (const range of ranges) {
    const start = Math.max(anchor.from, sourceSecondsToTimelineFrame(anchor, range.start, fps))
    const end = Math.min(
      anchor.from + anchor.durationInFrames,
      sourceSecondsToTimelineFrame(anchor, range.end, fps),
    )
    if (end <= start) throw new Error('The selected word is smaller than one timeline frame.')
    for (const linked of linkedItems) {
      assertTranscriptSplitOutsideTransition(linked, start)
      assertTranscriptSplitOutsideTransition(linked, end)
    }
  }
}

function removeTimelineRangesFromItems(
  commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS' | 'REMOVE_TRANSCRIPT_SELECTION',
  itemIds: string[],
  rangesByMediaId: Record<string, RemoveSilenceRange[]>,
  rangesByItemId?: Record<string, RemoveSilenceRange[]>,
): RemoveSilenceResult {
  if (itemIds.length === 0) {
    return { analyzedItemCount: 0, removedRangeCount: 0, removedItemCount: 0, splitCount: 0 }
  }

  const preflight = buildRangeRemovalPreflight(itemIds, rangesByMediaId, rangesByItemId)
  if (preflight.mutationIds.length === 0 || !canMutateTimelineItems(preflight.mutationIds)) {
    return {
      analyzedItemCount: preflight.analyzedItemCount,
      removedRangeCount: 0,
      removedItemCount: 0,
      splitCount: 0,
    }
  }

  if (rangesByItemId) {
    for (const anchor of getRangeRemovalAnchors(itemIds, rangesByMediaId, rangesByItemId)) {
      assertTranscriptRangesRepresentable(anchor, rangesByItemId[anchor.id] ?? [])
    }
  }

  return execute(
    commandType,
    () => {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const initialItems = useItemsStore.getState().items
      const anchorIds = getUniqueLinkedItemAnchorIds(initialItems, itemIds)
      const anchors = anchorIds
        .map((id) => initialItems.find((item) => item.id === id))
        .filter(
          (item): item is TimelineItem =>
            item !== undefined &&
            (item.type === 'video' || item.type === 'audio') &&
            !!item.mediaId &&
            ((rangesByItemId ? rangesByItemId[item.id] : rangesByMediaId[item.mediaId])?.length ??
              0) > 0,
        )

      if (anchors.length === 0) {
        return { analyzedItemCount: 0, removedRangeCount: 0, removedItemCount: 0, splitCount: 0 }
      }

      const anchorDescriptors = anchors.map((item) => ({
        id: item.id,
        mediaId: item.mediaId!,
        originId: item.originId ?? item.id,
        // Only these actual IDs and their split descendants belong to this selection.
        // Shared originId/time bounds can also describe an independent stacked repeat.
        descendantIds: new Set(
          getLinkedItemsForEdit(initialItems, item.id, !!rangesByItemId).map((linked) => linked.id),
        ),
      }))

      let splitCount = 0
      for (const anchor of anchors) {
        const ranges = rangesByItemId ? rangesByItemId[anchor.id] : rangesByMediaId[anchor.mediaId!]
        if (!ranges || ranges.length === 0) continue

        const splitFrames = Array.from(
          new Set(
            ranges.flatMap((range) => [
              sourceSecondsToTimelineFrame(anchor, range.start, timelineFps),
              sourceSecondsToTimelineFrame(anchor, range.end, timelineFps),
            ]),
          ),
        )
          .filter((frame) => frame > anchor.from && frame < anchor.from + anchor.durationInFrames)
          .sort((left, right) => right - left)

        if (splitFrames.length === 0) continue

        const itemsToSplit = getLinkedItemsForEdit(
          useItemsStore.getState().items,
          anchor.id,
          !!rangesByItemId || isLinkedSelectionEnabled(),
        )
        if (itemsToSplit.length === 0) continue

        for (const frame of splitFrames) {
          const currentItemsById = useItemsStore.getState().itemById
          const canSplitFrame = itemsToSplit.every((item) => {
            const currentItem = currentItemsById[item.id]
            if (!currentItem) return false
            if (
              frame <= currentItem.from ||
              frame >= currentItem.from + currentItem.durationInFrames
            ) {
              return false
            }

            const relativeFrame = frame - currentItem.from
            return !isInTransitionOverlap(
              currentItem.id,
              relativeFrame,
              currentItem.durationInFrames,
            )
          })

          if (!canSplitFrame) continue

          const frameSplitResults = itemsToSplit
            .map((item) => ({
              originalId: item.id,
              originalLinkedGroupId: item.linkedGroupId,
              result: useItemsStore.getState()._splitItem(item.id, frame),
            }))
            .filter((entry): entry is SplitResultEntry => entry.result !== null)

          if (frameSplitResults.length !== itemsToSplit.length) continue

          for (const descriptor of anchorDescriptors) {
            for (const entry of frameSplitResults) {
              if (descriptor.descendantIds.has(entry.originalId)) {
                descriptor.descendantIds.add(entry.result.leftItem.id)
                descriptor.descendantIds.add(entry.result.rightItem.id)
              }
            }
          }
          applySplitBookkeeping(frameSplitResults)
          splitCount += 1

          for (const entry of frameSplitResults) {
            applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id])
          }
        }
      }

      const currentItems = useItemsStore.getState().items
      const idsToRemove = new Set<string>()
      const removedRangeKeys = new Set<string>()

      for (const descriptor of anchorDescriptors) {
        const ranges = rangesByItemId
          ? rangesByItemId[descriptor.id]
          : rangesByMediaId[descriptor.mediaId]
        if (!ranges || ranges.length === 0) continue

        for (const candidate of currentItems) {
          if (candidate.type !== 'video' && candidate.type !== 'audio') continue
          if (rangesByItemId) {
            if (!descriptor.descendantIds.has(candidate.id)) continue
          } else {
            if (candidate.mediaId !== descriptor.mediaId) continue
            if ((candidate.originId ?? candidate.id) !== descriptor.originId) continue
          }

          const span = getItemSourceSpanSeconds(candidate, timelineFps)
          if (span !== null && isMostlyInsideRanges(span, ranges)) {
            idsToRemove.add(candidate.id)
            ranges.forEach((range, rangeIndex) => {
              if (range.end > span.start && range.start < span.end) {
                removedRangeKeys.add(`${descriptor.originId}:${rangeIndex}`)
              }
            })
          }
        }
      }

      if (idsToRemove.size === 0) {
        return {
          analyzedItemCount: anchors.length,
          removedRangeCount: 0,
          removedItemCount: 0,
          splitCount,
        }
      }

      const removalResult = applyRippleRemoval(Array.from(idsToRemove), !!rangesByItemId)
      const affectedIds = Array.from(new Set([...idsToRemove, ...removalResult.affectedIds]))
      requestPostEditWarmForItems(affectedIds)
      useTimelineSettingsStore.getState().markDirty()

      return {
        analyzedItemCount: anchors.length,
        removedRangeCount: removedRangeKeys.size,
        removedItemCount: removalResult.removedIds.length,
        splitCount,
      }
    },
    { itemIds, mediaCount: Object.keys(rangesByMediaId).length },
  )
}
