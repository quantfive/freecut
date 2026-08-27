import { useItemsStore } from '../items-store'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { isTrackSyncLockEnabled } from '../../utils/track-sync-lock'
import type { PreviewItemUpdate } from '../../utils/item-edit-preview'
import { applySplitBookkeeping, type SplitResultEntry } from './split-bookkeeping'
import { getLinkedItems } from '../../utils/linked-items'
import { isTimelineTrackLocked } from '../../utils/track-lock-invariants'

export interface RipplePropagationResult {
  affectedIds: string[]
  removedIds: string[]
}

interface TimeInterval {
  start: number
  end: number
}

interface PreviewTrackItemState {
  id: string
  trackId: string
  from: number
  durationInFrames: number
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

function normalizeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = intervals
    .map((interval) => ({
      start: Math.max(0, Math.round(interval.start)),
      end: Math.max(0, Math.round(interval.end)),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start)

  if (sorted.length === 0) {
    return []
  }

  const merged: TimeInterval[] = [sorted[0]!]
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!
    const previous = merged[merged.length - 1]!
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }
    merged.push({ ...current })
  }

  return merged
}

function canSyncLockRippleTrack(
  tracks: TimelineTrack[],
  track: TimelineTrack | undefined,
  trackId: string,
): boolean {
  return isTrackSyncLockEnabled(track) && !isTimelineTrackLocked(tracks, trackId)
}

function getCandidateTrackIdsFromState(
  items: TimelineItem[],
  tracks: TimelineTrack[],
  editedTrackIds: Set<string>,
): string[] {
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const declaredCandidateIds = tracks
    .filter(
      (track) => !editedTrackIds.has(track.id) && canSyncLockRippleTrack(tracks, track, track.id),
    )
    .map((track) => track.id)
  const itemCandidateIds = items
    .map((item) => item.trackId)
    .filter(
      (trackId) =>
        !editedTrackIds.has(trackId) &&
        canSyncLockRippleTrack(tracks, trackById.get(trackId), trackId),
    )

  return uniqueIds([...declaredCandidateIds, ...itemCandidateIds])
}

function getCandidateTrackIds(editedTrackIds: Set<string>): string[] {
  const { items, tracks } = useItemsStore.getState()
  return getCandidateTrackIdsFromState(items, tracks, editedTrackIds)
}

function toPreviewTrackState(item: TimelineItem): PreviewTrackItemState {
  return {
    id: item.id,
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
  }
}

function setPreviewUpdate(
  updatesById: Map<string, PreviewItemUpdate>,
  itemId: string,
  updates: Omit<PreviewItemUpdate, 'id'>,
): void {
  updatesById.set(itemId, {
    ...(updatesById.get(itemId) ?? { id: itemId }),
    ...updates,
  })
}

function applySplitBookkeepingByLinkedGroup(entries: SplitResultEntry[]): void {
  const unlinkedEntries: SplitResultEntry[] = []
  const entriesByLinkedGroupId = new Map<string, SplitResultEntry[]>()

  for (const entry of entries) {
    if (!entry.originalLinkedGroupId) {
      unlinkedEntries.push(entry)
      continue
    }

    const groupEntries = entriesByLinkedGroupId.get(entry.originalLinkedGroupId)
    if (groupEntries) groupEntries.push(entry)
    else entriesByLinkedGroupId.set(entry.originalLinkedGroupId, [entry])
  }

  applySplitBookkeeping(unlinkedEntries)
  for (const groupEntries of entriesByLinkedGroupId.values()) {
    applySplitBookkeeping(groupEntries)
  }
}

function splitItemsWithBookkeeping(itemIds: string[], splitFrame: number): SplitResultEntry[] {
  const store = useItemsStore.getState()
  const entries = itemIds.flatMap((itemId) => {
    const current = useItemsStore.getState().itemById[itemId]
    if (!current) return []

    const result = store._splitItem(itemId, splitFrame)
    return result
      ? [{ originalId: current.id, originalLinkedGroupId: current.linkedGroupId, result }]
      : []
  })

  applySplitBookkeepingByLinkedGroup(entries)
  return entries
}

function buildRemovedIntervalPreviewUpdatesForTrack(
  trackItems: TimelineItem[],
  intervals: TimeInterval[],
): PreviewItemUpdate[] {
  let previewItems = trackItems
    .map(toPreviewTrackState)
    .sort((left, right) => left.from - right.from)
  const updatesById = new Map<string, PreviewItemUpdate>()

  let removedFrames = 0
  for (const interval of normalizeIntervals(intervals)) {
    const currentInterval = {
      start: interval.start - removedFrames,
      end: interval.end - removedFrames,
    }
    const intervalLength = currentInterval.end - currentInterval.start
    if (intervalLength <= 0) continue

    const nextPreviewItems: PreviewTrackItemState[] = []
    for (const item of previewItems) {
      const itemEnd = item.from + item.durationInFrames
      if (itemEnd <= currentInterval.start) {
        nextPreviewItems.push(item)
        continue
      }

      if (item.from >= currentInterval.end) {
        const updated = {
          ...item,
          from: Math.max(0, item.from - intervalLength),
        }
        nextPreviewItems.push(updated)
        setPreviewUpdate(updatesById, item.id, { from: updated.from })
        continue
      }

      const startsBeforeInterval = item.from < currentInterval.start
      const endsAfterInterval = itemEnd > currentInterval.end

      if (!startsBeforeInterval && !endsAfterInterval) {
        setPreviewUpdate(updatesById, item.id, { hidden: true })
        continue
      }

      if (startsBeforeInterval && endsAfterInterval) {
        const updated = {
          ...item,
          durationInFrames: Math.max(1, item.durationInFrames - intervalLength),
        }
        nextPreviewItems.push(updated)
        setPreviewUpdate(updatesById, item.id, {
          durationInFrames: updated.durationInFrames,
        })
        continue
      }

      if (startsBeforeInterval) {
        const updated = {
          ...item,
          durationInFrames: Math.max(1, currentInterval.start - item.from),
        }
        nextPreviewItems.push(updated)
        setPreviewUpdate(updatesById, item.id, {
          durationInFrames: updated.durationInFrames,
        })
        continue
      }

      const updated = {
        ...item,
        from: currentInterval.start,
        durationInFrames: Math.max(1, itemEnd - currentInterval.end),
      }
      nextPreviewItems.push(updated)
      setPreviewUpdate(updatesById, item.id, {
        from: updated.from,
        durationInFrames: updated.durationInFrames,
      })
    }

    previewItems = nextPreviewItems.sort((left, right) => left.from - right.from)
    removedFrames += intervalLength
  }

  return [...updatesById.values()]
}

function buildInsertedGapPreviewUpdatesForTrack(
  trackItems: TimelineItem[],
  cutFrame: number,
  amount: number,
): PreviewItemUpdate[] {
  const updatesById = new Map<string, PreviewItemUpdate>()
  for (const item of trackItems) {
    const itemEnd = item.from + item.durationInFrames
    if (itemEnd <= cutFrame) {
      continue
    }

    if (item.from >= cutFrame) {
      setPreviewUpdate(updatesById, item.id, {
        from: item.from + amount,
      })
      continue
    }

    setPreviewUpdate(updatesById, item.id, {
      durationInFrames: item.durationInFrames + amount,
    })
  }

  return [...updatesById.values()]
}

function getAtomicCandidateTrackIds(params: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  candidateTrackIds: string[]
  updatesByTrackId: ReadonlyMap<string, PreviewItemUpdate[]>
  additionalAffectedIds?: ReadonlySet<string>
}): string[] {
  const safeTrackIds = new Set(params.candidateTrackIds)
  const itemById = new Map(params.items.map((item) => [item.id, item]))

  let changed = true
  while (changed) {
    changed = false
    const affectedIds = new Set(params.additionalAffectedIds ?? [])
    for (const trackId of safeTrackIds) {
      for (const update of params.updatesByTrackId.get(trackId) ?? []) {
        affectedIds.add(update.id)
      }
    }

    for (const trackId of [...safeTrackIds]) {
      const trackUpdates = params.updatesByTrackId.get(trackId) ?? []
      const blocksTrack = trackUpdates.some((update) => {
        const item = itemById.get(update.id)
        if (!item) return true

        const linkedItems = getLinkedItems(params.items, item.id)
        if (linkedItems.length <= 1) return false

        const hasLockedMember = linkedItems.some((linkedItem) =>
          isTimelineTrackLocked(params.tracks, linkedItem.trackId),
        )
        const mutatesWholeCohort = linkedItems.every((linkedItem) => affectedIds.has(linkedItem.id))
        return hasLockedMember || !mutatesWholeCohort
      })

      if (blocksTrack) {
        safeTrackIds.delete(trackId)
        changed = true
      }
    }
  }

  return params.candidateTrackIds.filter((trackId) => safeTrackIds.has(trackId))
}

function buildRemovedUpdatesByTrack(params: {
  items: TimelineItem[]
  candidateTrackIds: string[]
  intervals: TimeInterval[]
}): Map<string, PreviewItemUpdate[]> {
  return new Map(
    params.candidateTrackIds.map((trackId) => [
      trackId,
      buildRemovedIntervalPreviewUpdatesForTrack(
        params.items.filter((item) => item.trackId === trackId),
        params.intervals,
      ),
    ]),
  )
}

function buildInsertedUpdatesByTrack(params: {
  items: TimelineItem[]
  candidateTrackIds: string[]
  cutFrame: number
  amount: number
}): Map<string, PreviewItemUpdate[]> {
  return new Map(
    params.candidateTrackIds.map((trackId) => [
      trackId,
      buildInsertedGapPreviewUpdatesForTrack(
        params.items.filter((item) => item.trackId === trackId),
        params.cutFrame,
        params.amount,
      ),
    ]),
  )
}

export function buildRemovedIntervalPreviewUpdatesForSyncLockedTracks(params: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  editedTrackIds: Set<string>
  intervals: TimeInterval[]
  additionalAffectedIds?: ReadonlySet<string>
}): PreviewItemUpdate[] {
  const intervals = normalizeIntervals(params.intervals)
  if (intervals.length === 0) {
    return []
  }

  const candidateTrackIds = getCandidateTrackIdsFromState(
    params.items,
    params.tracks,
    params.editedTrackIds,
  )
  const updatesByTrackId = buildRemovedUpdatesByTrack({
    items: params.items,
    candidateTrackIds,
    intervals,
  })
  const atomicTrackIds = getAtomicCandidateTrackIds({
    items: params.items,
    tracks: params.tracks,
    candidateTrackIds,
    updatesByTrackId,
    additionalAffectedIds: params.additionalAffectedIds,
  })

  return atomicTrackIds.flatMap((trackId) => updatesByTrackId.get(trackId) ?? [])
}

export function buildInsertedGapPreviewUpdatesForSyncLockedTracks(params: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  editedTrackIds: Set<string>
  cutFrame: number
  amount: number
  additionalAffectedIds?: ReadonlySet<string>
}): PreviewItemUpdate[] {
  const cutFrame = Math.max(0, Math.round(params.cutFrame))
  const amount = Math.max(0, Math.round(params.amount))
  if (amount === 0) {
    return []
  }

  const candidateTrackIds = getCandidateTrackIdsFromState(
    params.items,
    params.tracks,
    params.editedTrackIds,
  )
  const updatesByTrackId = buildInsertedUpdatesByTrack({
    items: params.items,
    candidateTrackIds,
    cutFrame,
    amount,
  })
  const atomicTrackIds = getAtomicCandidateTrackIds({
    items: params.items,
    tracks: params.tracks,
    candidateTrackIds,
    updatesByTrackId,
    additionalAffectedIds: params.additionalAffectedIds,
  })

  return atomicTrackIds.flatMap((trackId) => updatesByTrackId.get(trackId) ?? [])
}

function removeIntervalFromTracks(
  trackIds: ReadonlySet<string>,
  interval: TimeInterval,
): RipplePropagationResult {
  const store = useItemsStore.getState()
  const affectedIds: string[] = []
  const overlapping = useItemsStore
    .getState()
    .items.filter(
      (item) =>
        trackIds.has(item.trackId) &&
        item.from < interval.end &&
        item.from + item.durationInFrames > interval.start,
    )

  const startSplitEntries = splitItemsWithBookkeeping(
    overlapping.filter((item) => item.from < interval.start).map((item) => item.id),
    interval.start,
  )
  for (const entry of startSplitEntries) {
    affectedIds.push(entry.result.leftItem.id, entry.result.rightItem.id)
  }

  const endSplitEntries = splitItemsWithBookkeeping(
    useItemsStore
      .getState()
      .items.filter(
        (item) =>
          trackIds.has(item.trackId) &&
          item.from < interval.end &&
          item.from + item.durationInFrames > interval.end,
      )
      .map((item) => item.id),
    interval.end,
  )
  for (const entry of endSplitEntries) {
    affectedIds.push(entry.result.leftItem.id, entry.result.rightItem.id)
  }

  const removedIds = useItemsStore
    .getState()
    .items.filter(
      (item) =>
        trackIds.has(item.trackId) &&
        item.from >= interval.start &&
        item.from + item.durationInFrames <= interval.end,
    )
    .map((item) => item.id)
  if (removedIds.length > 0) store._removeItems(removedIds)

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: uniqueIds(removedIds),
  }
}

function shiftTrackItems(
  trackIds: ReadonlySet<string>,
  predicate: (item: TimelineItem) => boolean,
  delta: number,
): string[] {
  if (delta === 0) {
    return []
  }

  const store = useItemsStore.getState()
  const updates = useItemsStore
    .getState()
    .items.filter((item) => trackIds.has(item.trackId) && predicate(item))
    .map((item) => ({
      id: item.id,
      from: Math.max(0, item.from + delta),
    }))

  if (updates.length > 0) {
    store._moveItems(updates)
  }

  return updates.map((update) => update.id)
}

export function propagateRemovedIntervalsToSyncLockedTracks(params: {
  editedTrackIds: Set<string>
  intervals: TimeInterval[]
  additionalAffectedIds?: ReadonlySet<string>
}): RipplePropagationResult {
  const intervals = normalizeIntervals(params.intervals)
  if (intervals.length === 0) {
    return { affectedIds: [], removedIds: [] }
  }

  const { items, tracks } = useItemsStore.getState()
  const candidateTrackIds = getCandidateTrackIds(params.editedTrackIds)
  const updatesByTrackId = buildRemovedUpdatesByTrack({ items, candidateTrackIds, intervals })
  const atomicTrackIds = new Set(
    getAtomicCandidateTrackIds({
      items,
      tracks,
      candidateTrackIds,
      updatesByTrackId,
      additionalAffectedIds: params.additionalAffectedIds,
    }),
  )
  const affectedIds: string[] = []
  const removedIds: string[] = []

  let removedFrames = 0
  for (const interval of intervals) {
    const currentInterval = {
      start: interval.start - removedFrames,
      end: interval.end - removedFrames,
    }
    const intervalLength = currentInterval.end - currentInterval.start
    if (intervalLength <= 0) continue

    const overlapResult = removeIntervalFromTracks(atomicTrackIds, currentInterval)
    affectedIds.push(...overlapResult.affectedIds)
    removedIds.push(...overlapResult.removedIds)
    affectedIds.push(
      ...shiftTrackItems(
        atomicTrackIds,
        (item) => item.from >= currentInterval.end,
        -intervalLength,
      ),
    )

    removedFrames += intervalLength
  }

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: uniqueIds(removedIds),
  }
}

export function propagateInsertedGapToSyncLockedTracks(params: {
  editedTrackIds: Set<string>
  cutFrame: number
  amount: number
  additionalAffectedIds?: ReadonlySet<string>
}): RipplePropagationResult {
  const cutFrame = Math.max(0, Math.round(params.cutFrame))
  const amount = Math.max(0, Math.round(params.amount))
  if (amount === 0) {
    return { affectedIds: [], removedIds: [] }
  }

  const { items, tracks } = useItemsStore.getState()
  const candidateTrackIds = getCandidateTrackIds(params.editedTrackIds)
  const updatesByTrackId = buildInsertedUpdatesByTrack({
    items,
    candidateTrackIds,
    cutFrame,
    amount,
  })
  const atomicTrackIds = new Set(
    getAtomicCandidateTrackIds({
      items,
      tracks,
      candidateTrackIds,
      updatesByTrackId,
      additionalAffectedIds: params.additionalAffectedIds,
    }),
  )
  const affectedIds: string[] = []

  const splitEntries = splitItemsWithBookkeeping(
    useItemsStore
      .getState()
      .items.filter(
        (item) =>
          atomicTrackIds.has(item.trackId) &&
          item.from < cutFrame &&
          item.from + item.durationInFrames > cutFrame,
      )
      .map((item) => item.id),
    cutFrame,
  )
  for (const entry of splitEntries) {
    affectedIds.push(entry.result.leftItem.id, entry.result.rightItem.id)
  }

  affectedIds.push(...shiftTrackItems(atomicTrackIds, (item) => item.from >= cutFrame, amount))

  return {
    affectedIds: uniqueIds(affectedIds),
    removedIds: [],
  }
}
