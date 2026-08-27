import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { resolveEffectiveTrackStates } from './group-utils'
import { getLinkedItems } from './linked-items'

export interface ItemMutationLockPartition {
  allowedIds: string[]
  blockedIds: string[]
  blockedByLockedLinkedCohort: boolean
}

export interface TimelineMutationPreflight extends ItemMutationLockPartition {
  allowed: boolean
  lockedDestinationTrackIds: string[]
}

function getLockedTrackIds(tracks: TimelineTrack[]): Set<string> {
  const lockedTrackIds = new Set(
    resolveEffectiveTrackStates(tracks)
      .filter((track) => track.locked)
      .map((track) => track.id),
  )

  for (const track of tracks) {
    if (track.locked) lockedTrackIds.add(track.id)
  }

  return lockedTrackIds
}

export function isTimelineTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return getLockedTrackIds(tracks).has(trackId)
}

/**
 * Partition a proposed item mutation without ever peeling an unlocked member
 * away from a linked cohort that contains a locked member.
 *
 * Standalone items on locked tracks are simply ineligible. A linked cohort is
 * stronger: if any companion is locked, every proposed mutation in that
 * cohort is rejected so an A/V pair cannot be silently desynchronized.
 */
export function partitionItemMutationIdsByLock(params: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  itemIds: Iterable<string>
}): ItemMutationLockPartition {
  const requestedIds = Array.from(new Set(params.itemIds))
  const requestedIdSet = new Set(requestedIds)
  const lockedTrackIds = getLockedTrackIds(params.tracks)
  const itemById = new Map(params.items.map((item) => [item.id, item]))
  const blockedIds = new Set<string>()
  let blockedByLockedLinkedCohort = false

  for (const itemId of requestedIds) {
    if (blockedIds.has(itemId)) continue

    const item = itemById.get(itemId)
    if (!item) {
      blockedIds.add(itemId)
      continue
    }

    const linkedItems = getLinkedItems(params.items, item.id)
    const hasLockedMember = linkedItems.some((linkedItem) => lockedTrackIds.has(linkedItem.trackId))

    if (!hasLockedMember) continue

    blockedByLockedLinkedCohort ||= linkedItems.length > 1
    for (const linkedItem of linkedItems) {
      if (requestedIdSet.has(linkedItem.id)) blockedIds.add(linkedItem.id)
    }
  }

  return {
    allowedIds: requestedIds.filter((itemId) => !blockedIds.has(itemId)),
    blockedIds: requestedIds.filter((itemId) => blockedIds.has(itemId)),
    blockedByLockedLinkedCohort,
  }
}

/**
 * Validate an entire public-action mutation cohort before its first write.
 *
 * Callers must provide every existing item whose timing, source window, or
 * existence the action can change. Linked cohorts are intentionally checked
 * independent of the linked-selection preference: opting out of synchronized
 * selection must never let an unlocked member peel away from a locked one.
 * Destination lanes are checked separately so cross-track moves and source
 * edits cannot write into an effectively locked Layer Group child.
 */
export function preflightTimelineMutation(params: {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  itemIds: Iterable<string>
  destinationTrackIds?: Iterable<string>
}): TimelineMutationPreflight {
  const partition = partitionItemMutationIdsByLock(params)
  const lockedTrackIds = getLockedTrackIds(params.tracks)
  const lockedDestinationTrackIds = Array.from(new Set(params.destinationTrackIds ?? [])).filter(
    (trackId) => lockedTrackIds.has(trackId),
  )

  return {
    ...partition,
    allowed: partition.blockedIds.length === 0 && lockedDestinationTrackIds.length === 0,
    lockedDestinationTrackIds,
  }
}
