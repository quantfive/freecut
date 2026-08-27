import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import type { TimelineItem } from '@/types/timeline'
import { execute, applyTransitionRepairs } from '../shared'
import { getSynchronizedLinkedItemsForEdit } from '../linked-edit'
import { timelineToSourceFrames, sourceToTimelineFrames } from '../../../utils/source-calculations'
import { expandItemIdsWithAttachedCaptions, getLinkedItemIds } from '../../../utils/linked-items'
import {
  canMutateTimelineItems,
  isLinkedSelectionEnabled,
  requestPostEditWarmForItems,
} from './shared'
import { roundDuration, roundFrame } from '../../items-store-normalize'

function addLinkedRippleCohort(
  items: TimelineItem[],
  itemId: string,
  mutationIds: Set<string>,
): void {
  for (const relatedId of expandItemIdsWithAttachedCaptions(
    items,
    getLinkedItemIds(items, itemId),
  )) {
    mutationIds.add(relatedId)
  }
}

function collectRateStretchEndMutationIds(params: {
  items: TimelineItem[]
  synchronizedItems: TimelineItem[]
  synchronizedIds: Set<string>
  touchedTrackIds: Set<string>
  oldEnd: number
  mutationIds: Set<string>
}): void {
  for (const candidate of params.items) {
    if (
      params.synchronizedIds.has(candidate.id) ||
      !params.touchedTrackIds.has(candidate.trackId) ||
      candidate.from < params.oldEnd
    ) {
      continue
    }
    addLinkedRippleCohort(params.items, candidate.id, params.mutationIds)
  }

  const transitions = useTransitionsStore.getState().transitions
  for (const synchronizedItem of params.synchronizedItems) {
    for (const transition of transitions) {
      if (transition.leftClipId !== synchronizedItem.id) continue
      addLinkedRippleCohort(params.items, transition.rightClipId, params.mutationIds)
    }
  }
}

function collectRateStretchStartMutationIds(params: {
  items: TimelineItem[]
  synchronizedItems: TimelineItem[]
  synchronizedIds: Set<string>
  touchedTrackIds: Set<string>
  oldFrom: number
  mutationIds: Set<string>
}): void {
  for (const candidate of params.items) {
    if (
      params.synchronizedIds.has(candidate.id) ||
      !params.touchedTrackIds.has(candidate.trackId) ||
      candidate.from + candidate.durationInFrames > params.oldFrom
    ) {
      continue
    }
    addLinkedRippleCohort(params.items, candidate.id, params.mutationIds)
  }

  const transitions = useTransitionsStore.getState().transitions
  for (const synchronizedItem of params.synchronizedItems) {
    for (const transition of transitions) {
      if (transition.rightClipId !== synchronizedItem.id) continue
      addLinkedRippleCohort(params.items, transition.leftClipId, params.mutationIds)
    }
  }
}

function getRateStretchMutationIds(id: string, newFrom: number, newDuration: number): string[] {
  const items = useItemsStore.getState().items
  const synchronizedItems = getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled())
  const anchor = synchronizedItems.find((item) => item.id === id)
  if (!anchor) return []

  const synchronizedIds = new Set(synchronizedItems.map((item) => item.id))
  const mutationIds = new Set(synchronizedIds)
  const oldEnd = anchor.from + anchor.durationInFrames
  const fromDelta = roundFrame(newFrom) - anchor.from
  const endDelta = roundFrame(newFrom) + roundDuration(newDuration) - oldEnd
  const touchedTrackIds = new Set(synchronizedItems.map((item) => item.trackId))

  if (endDelta !== 0) {
    collectRateStretchEndMutationIds({
      items,
      synchronizedItems,
      synchronizedIds,
      touchedTrackIds,
      oldEnd,
      mutationIds,
    })
  }

  if (fromDelta !== 0) {
    collectRateStretchStartMutationIds({
      items,
      synchronizedItems,
      synchronizedIds,
      touchedTrackIds,
      oldFrom: anchor.from,
      mutationIds,
    })
  }

  return Array.from(mutationIds)
}

interface ResetSpeedMutationPlan {
  synchronizedItems: TimelineItem[]
  oldEnd: number
  growth: number
}

function calculateResetSpeedDuration(item: TimelineItem, fps: number): number {
  const currentSpeed = item.speed || 1
  const sourceFps = item.sourceFps ?? fps
  const effectiveSourceFrames =
    item.sourceEnd !== undefined && item.sourceStart !== undefined
      ? item.sourceEnd - item.sourceStart
      : timelineToSourceFrames(item.durationInFrames, currentSpeed, fps, sourceFps)
  return Math.max(1, sourceToTimelineFrames(effectiveSourceFrames, 1, sourceFps, fps))
}

function getResetSpeedMutationPlan(
  items: TimelineItem[],
  id: string,
  fps: number,
): ResetSpeedMutationPlan | null {
  const item = items.find((candidate) => candidate.id === id)
  if (!item || (item.type !== 'video' && item.type !== 'audio')) return null
  const currentSpeed = item.speed || 1
  if (Math.abs(currentSpeed - 1) <= 0.01) return null

  const synchronizedItems = getSynchronizedLinkedItemsForEdit(items, id, isLinkedSelectionEnabled())
  const newDuration = calculateResetSpeedDuration(item, fps)
  return {
    synchronizedItems,
    oldEnd: item.from + item.durationInFrames,
    growth: roundDuration(newDuration) - item.durationInFrames,
  }
}

function addResetSpeedDownstreamMutationIds(params: {
  items: TimelineItem[]
  plan: ResetSpeedMutationPlan
  processedIds: Set<string>
  mutationIds: Set<string>
}): void {
  if (params.plan.growth <= 0) return
  const touchedTrackIds = new Set(params.plan.synchronizedItems.map((item) => item.trackId))
  for (const candidate of params.items) {
    if (
      params.processedIds.has(candidate.id) ||
      !touchedTrackIds.has(candidate.trackId) ||
      candidate.from < params.plan.oldEnd
    ) {
      continue
    }
    addLinkedRippleCohort(params.items, candidate.id, params.mutationIds)
  }
}

function getResetSpeedMutationIds(itemIds: string[]): string[] {
  const items = useItemsStore.getState().items
  const fps = useTimelineSettingsStore.getState().fps
  const mutationIds = new Set<string>()
  const processedIds = new Set<string>()

  for (const id of itemIds) {
    if (processedIds.has(id)) continue
    const plan = getResetSpeedMutationPlan(items, id, fps)
    if (!plan) continue
    for (const synchronizedItem of plan.synchronizedItems) {
      processedIds.add(synchronizedItem.id)
      mutationIds.add(synchronizedItem.id)
    }
    addResetSpeedDownstreamMutationIds({ items, plan, processedIds, mutationIds })
  }

  return Array.from(mutationIds)
}

export function rateStretchItemWithoutHistory(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
): void {
  const mutationIds = getRateStretchMutationIds(id, newFrom, newDuration)
  if (mutationIds.length === 0 || !canMutateTimelineItems(mutationIds)) return

  const itemsStore = useItemsStore.getState()
  const itemsBefore = itemsStore.items
  const synchronizedItems = getSynchronizedLinkedItemsForEdit(
    itemsBefore,
    id,
    isLinkedSelectionEnabled(),
  )
  const anchorBefore = synchronizedItems.find((item) => item.id === id)
  if (!anchorBefore) return

  // Capture old boundaries BEFORE stretch (needed for ripple + keyframe scaling)
  const oldDuration = anchorBefore.durationInFrames
  const oldFrom = anchorBefore.from
  const oldEnd = oldFrom + oldDuration

  itemsStore._rateStretchItem(id, newFrom, newDuration, newSpeed)

  const anchorAfter = useItemsStore.getState().itemById[id]
  if (!anchorAfter) return

  const actualFrom = anchorAfter.from
  const actualDuration = anchorAfter.durationInFrames
  const actualSpeed = anchorAfter.speed ?? newSpeed
  const fromDelta = actualFrom - anchorBefore.from

  for (const synchronizedItem of synchronizedItems) {
    if (synchronizedItem.id === id) continue
    itemsStore._rateStretchItem(
      synchronizedItem.id,
      synchronizedItem.from + fromDelta,
      actualDuration,
      actualSpeed,
    )
  }

  // Scale keyframes proportionally to match new duration
  // This ensures animations maintain their relative timing within the clip
  if (oldDuration !== actualDuration) {
    for (const synchronizedItem of synchronizedItems) {
      useKeyframesStore
        .getState()
        ._scaleKeyframesForItem(
          synchronizedItem.id,
          synchronizedItem.durationInFrames,
          actualDuration,
        )
    }
  }

  // Ripple phase: push/pull adjacent clips to maintain adjacency and prevent overlaps.
  // End handle: endDelta !== 0 → shift downstream clips.
  // Start handle: fromDelta !== 0, end stays fixed → shift upstream clips.
  const newEnd = actualFrom + actualDuration
  const endDelta = newEnd - oldEnd
  const allSynchronizedIds = new Set(synchronizedItems.map((si) => si.id))
  const freshItems = useItemsStore.getState().items
  const transitions = useTransitionsStore.getState().transitions
  const movedIds = new Set<string>()
  const moveUpdates: Array<{ id: string; from: number }> = []

  // Collect all track IDs touched by the stretched item + its linked companions
  const touchedTrackIds = new Set<string>()
  for (const si of synchronizedItems) {
    const freshSi = freshItems.find((i) => i.id === si.id)
    if (freshSi) touchedTrackIds.add(freshSi.trackId)
  }

  if (endDelta !== 0) {
    // End handle changed — shift downstream clips (at or past old end) on touched tracks
    for (const trackId of touchedTrackIds) {
      const downstreamItems = freshItems
        .filter((i) => i.trackId === trackId && !allSynchronizedIds.has(i.id) && i.from >= oldEnd)
        .sort((a, b) => a.from - b.from)

      for (const downstream of downstreamItems) {
        if (movedIds.has(downstream.id)) continue
        movedIds.add(downstream.id)
        moveUpdates.push({ id: downstream.id, from: downstream.from + endDelta })

        // Also move linked companions on other tracks
        const linkedIds = expandItemIdsWithAttachedCaptions(
          freshItems,
          getLinkedItemIds(freshItems, downstream.id),
        )
        for (const linkedId of linkedIds) {
          if (linkedId === downstream.id || movedIds.has(linkedId)) continue
          const linked = freshItems.find((i) => i.id === linkedId)
          if (linked) {
            movedIds.add(linkedId)
            moveUpdates.push({ id: linkedId, from: linked.from + endDelta })
          }
        }
      }
    }

    // Also shift transition-connected neighbors that aren't downstream by position
    // but are directly bridged to the stretched clip's end
    for (const si of synchronizedItems) {
      for (const t of transitions) {
        if (
          t.leftClipId === si.id &&
          !allSynchronizedIds.has(t.rightClipId) &&
          !movedIds.has(t.rightClipId)
        ) {
          const neighbor = freshItems.find((i) => i.id === t.rightClipId)
          if (neighbor) {
            movedIds.add(neighbor.id)
            moveUpdates.push({ id: neighbor.id, from: neighbor.from + endDelta })
            const linkedIds = expandItemIdsWithAttachedCaptions(
              freshItems,
              getLinkedItemIds(freshItems, neighbor.id),
            )
            for (const linkedId of linkedIds) {
              if (linkedId === neighbor.id || movedIds.has(linkedId)) continue
              const linked = freshItems.find((i) => i.id === linkedId)
              if (linked) {
                movedIds.add(linkedId)
                moveUpdates.push({ id: linkedId, from: linked.from + endDelta })
              }
            }
          }
        }
      }
    }
  }

  if (fromDelta !== 0) {
    // Start handle changed — shift upstream clips (ending at or before old from) on touched tracks
    for (const trackId of touchedTrackIds) {
      const upstreamItems = freshItems
        .filter((i) => {
          if (i.trackId !== trackId || allSynchronizedIds.has(i.id)) return false
          const iEnd = i.from + i.durationInFrames
          return iEnd <= oldFrom
        })
        .sort((a, b) => a.from - b.from)

      for (const upstream of upstreamItems) {
        if (movedIds.has(upstream.id)) continue
        movedIds.add(upstream.id)
        moveUpdates.push({ id: upstream.id, from: Math.max(0, upstream.from + fromDelta) })

        const linkedIds = expandItemIdsWithAttachedCaptions(
          freshItems,
          getLinkedItemIds(freshItems, upstream.id),
        )
        for (const linkedId of linkedIds) {
          if (linkedId === upstream.id || movedIds.has(linkedId)) continue
          const linked = freshItems.find((i) => i.id === linkedId)
          if (linked) {
            movedIds.add(linkedId)
            moveUpdates.push({ id: linkedId, from: Math.max(0, linked.from + fromDelta) })
          }
        }
      }
    }

    // Also shift transition-connected neighbors bridged to the stretched clip's start
    for (const si of synchronizedItems) {
      for (const t of transitions) {
        if (
          t.rightClipId === si.id &&
          !allSynchronizedIds.has(t.leftClipId) &&
          !movedIds.has(t.leftClipId)
        ) {
          const neighbor = freshItems.find((i) => i.id === t.leftClipId)
          if (neighbor) {
            movedIds.add(neighbor.id)
            moveUpdates.push({ id: neighbor.id, from: Math.max(0, neighbor.from + fromDelta) })
            const linkedIds = expandItemIdsWithAttachedCaptions(
              freshItems,
              getLinkedItemIds(freshItems, neighbor.id),
            )
            for (const linkedId of linkedIds) {
              if (linkedId === neighbor.id || movedIds.has(linkedId)) continue
              const linked = freshItems.find((i) => i.id === linkedId)
              if (linked) {
                movedIds.add(linkedId)
                moveUpdates.push({ id: linkedId, from: Math.max(0, linked.from + fromDelta) })
              }
            }
          }
        }
      }
    }
  }

  if (moveUpdates.length > 0) {
    useItemsStore.getState()._moveItems(moveUpdates)
  }

  // Repair transitions for all affected clips
  const allAffectedIds = [...allSynchronizedIds, ...movedIds]
  applyTransitionRepairs(allAffectedIds)
  requestPostEditWarmForItems(allAffectedIds)

  useTimelineSettingsStore.getState().markDirty()
}

export function rateStretchItem(
  id: string,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
): void {
  const mutationIds = getRateStretchMutationIds(id, newFrom, newDuration)
  if (mutationIds.length === 0 || !canMutateTimelineItems(mutationIds)) return

  execute(
    'RATE_STRETCH_ITEM',
    () => {
      rateStretchItemWithoutHistory(id, newFrom, newDuration, newSpeed)
    },
    { id, newFrom, newDuration, newSpeed },
  )
}

/**
 * Reset speed to 1x for the given items and push subsequent clips right to
 * avoid overlaps. Everything happens in a single undo entry.
 *
 * When a variable-speed clip (e.g. 1.23x) is reset to 1x, it gets longer.
 * Without ripple, it would overlap the next clip on the same track. This
 * function shifts all downstream clips (and their linked companions) right
 * by the growth amount.
 */
export function resetSpeedWithRipple(itemIds: string[]): void {
  const TOLERANCE = 0.01
  const mutationIds = getResetSpeedMutationIds(itemIds)
  if (mutationIds.length === 0 || !canMutateTimelineItems(mutationIds)) return

  execute(
    'RESET_SPEED_WITH_RIPPLE',
    () => {
      const itemsStore = useItemsStore.getState()
      const fps = useTimelineSettingsStore.getState().fps

      // Collect all items that need resetting (deduplicate via synchronized links)
      const processedIds = new Set<string>()
      const stretchOps: Array<{
        id: string
        trackId: string
        oldEnd: number
        newDuration: number
        synchronizedIds: string[]
      }> = []

      for (const id of itemIds) {
        if (processedIds.has(id)) continue
        const item = itemsStore.items.find((i) => i.id === id)
        if (!item || (item.type !== 'video' && item.type !== 'audio')) continue

        const currentSpeed = item.speed || 1
        if (Math.abs(currentSpeed - 1) <= TOLERANCE) continue

        const synchronizedItems = getSynchronizedLinkedItemsForEdit(
          itemsStore.items,
          id,
          isLinkedSelectionEnabled(),
        )
        for (const si of synchronizedItems) processedIds.add(si.id)

        const newDuration = calculateResetSpeedDuration(item, fps)
        const oldEnd = item.from + item.durationInFrames

        stretchOps.push({
          id,
          trackId: item.trackId,
          oldEnd,
          newDuration,
          synchronizedIds: synchronizedItems.map((si) => si.id),
        })
      }

      if (stretchOps.length === 0) return

      // Phase 1: Apply all rate stretches
      for (const op of stretchOps) {
        const anchor = itemsStore.items.find((i) => i.id === op.id)
        if (!anchor) continue

        const oldDuration = anchor.durationInFrames
        itemsStore._rateStretchItem(op.id, anchor.from, op.newDuration, 1)

        // Synchronize linked items
        const anchorAfter = useItemsStore.getState().itemById[op.id]
        if (!anchorAfter) continue

        const actualDuration = anchorAfter.durationInFrames
        const fromDelta = anchorAfter.from - anchor.from

        for (const siId of op.synchronizedIds) {
          if (siId === op.id) continue
          const si = useItemsStore.getState().items.find((i) => i.id === siId)
          if (!si) continue
          itemsStore._rateStretchItem(
            siId,
            si.from + fromDelta,
            actualDuration,
            anchorAfter.speed ?? 1,
          )
        }

        // Scale keyframes
        if (oldDuration !== actualDuration) {
          for (const siId of op.synchronizedIds) {
            useKeyframesStore.getState()._scaleKeyframesForItem(siId, oldDuration, actualDuration)
          }
        }
      }

      // Phase 2: Push subsequent clips right to resolve overlaps
      const freshItems = useItemsStore.getState().items
      const allChangedIds = new Set(stretchOps.flatMap((op) => op.synchronizedIds))
      const moveUpdates: Array<{ id: string; from: number }> = []
      const movedIds = new Set<string>()

      for (const op of stretchOps) {
        const stretchedItem = freshItems.find((i) => i.id === op.id)
        if (!stretchedItem) continue

        const newEnd = stretchedItem.from + stretchedItem.durationInFrames
        const growth = newEnd - op.oldEnd
        if (growth <= 0) continue

        // Find all track IDs touched by this item + its linked companions
        const touchedTrackIds = new Set<string>()
        for (const siId of op.synchronizedIds) {
          const si = freshItems.find((i) => i.id === siId)
          if (si) touchedTrackIds.add(si.trackId)
        }

        // On each touched track, push subsequent clips right
        for (const trackId of touchedTrackIds) {
          const trackItems = freshItems
            .filter((i) => i.trackId === trackId && !allChangedIds.has(i.id) && i.from >= op.oldEnd)
            .sort((a, b) => a.from - b.from)

          for (const downstream of trackItems) {
            if (movedIds.has(downstream.id)) continue
            movedIds.add(downstream.id)
            moveUpdates.push({ id: downstream.id, from: downstream.from + growth })

            // Also move linked companions on other tracks
            const linkedIds = expandItemIdsWithAttachedCaptions(
              freshItems,
              getLinkedItemIds(freshItems, downstream.id),
            )
            for (const linkedId of linkedIds) {
              if (linkedId === downstream.id || movedIds.has(linkedId)) continue
              const linked = freshItems.find((i) => i.id === linkedId)
              if (linked) {
                movedIds.add(linkedId)
                moveUpdates.push({ id: linkedId, from: linked.from + growth })
              }
            }
          }
        }
      }

      if (moveUpdates.length > 0) {
        useItemsStore.getState()._moveItems(moveUpdates)
      }

      // Phase 3: Repair transitions for all affected clips
      const allAffectedIds = [...allChangedIds, ...movedIds]
      applyTransitionRepairs(allAffectedIds)
      requestPostEditWarmForItems(allAffectedIds)

      useTimelineSettingsStore.getState().markDirty()
    },
    { itemIds },
  )
}
