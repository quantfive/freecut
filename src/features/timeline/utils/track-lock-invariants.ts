import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { resolveEffectiveTrackStates } from './group-utils'
import { getLinkedItems } from './linked-items'

export interface ItemMutationLockPartition {
  allowedIds: string[]
  blockedIds: string[]
  blockedByLockedLinkedCohort: boolean
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
