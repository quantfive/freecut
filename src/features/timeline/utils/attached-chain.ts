import type { TimelineItem } from '@/types/timeline'
import { getLinkedItems } from './linked-items'

/** Missing attachment metadata is intentionally attached for compatibility. */
function isRippleLinked(item: Pick<TimelineItem, 'rippleLinked'>): boolean {
  return item.rippleLinked !== false
}

function enqueueIfMissing(item: TimelineItem, included: Set<string>, queue: TimelineItem[]): void {
  if (included.has(item.id)) return
  included.add(item.id)
  queue.push(item)
}

function enqueueLinkedCohort(
  items: readonly TimelineItem[],
  current: TimelineItem,
  included: Set<string>,
  queue: TimelineItem[],
): void {
  for (const cohort of getLinkedItems([...items], current.id))
    enqueueIfMissing(cohort, included, queue)
}

function enqueueRippleDownstream(
  items: readonly TimelineItem[],
  current: TimelineItem,
  included: Set<string>,
  queue: TimelineItem[],
): void {
  const end = current.from + current.durationInFrames
  const downstream = items
    .filter((candidate) => candidate.trackId === current.trackId && candidate.from >= end)
    .sort((left, right) => left.from - right.from || left.id.localeCompare(right.id))
  for (const candidate of downstream) {
    if (!isRippleLinked(candidate)) break
    enqueueIfMissing(candidate, included, queue)
  }
}

/**
 * Resolve the forward attachment chain for an anchor. A chain advances only
 * across an exact touching boundary on the same lane. Linked A/V cohorts are
 * added as a unit, but linkedGroupId never creates sequence attachments by
 * itself. A false rippleLinked value is a hard break.
 */
export function resolveAttachedChain(items: readonly TimelineItem[], anchorId: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const anchor = byId.get(anchorId)
  if (!anchor) return []

  const result: string[] = []
  const included = new Set<string>()
  const queue: TimelineItem[] = [anchor]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (included.has(current.id)) continue
    included.add(current.id)
    result.push(current.id)

    for (const cohortItem of getLinkedItems([...items], current.id)) {
      if (!included.has(cohortItem.id)) queue.push(cohortItem)
    }
    // An explicit break stops the sequence tail but never breaks linked A/V
    // cohort synchronization itself.
    if (!isRippleLinked(current)) continue

    const end = current.from + current.durationInFrames
    const next = items
      .filter(
        (candidate) =>
          candidate.trackId === current.trackId &&
          candidate.id !== current.id &&
          candidate.from === end &&
          isRippleLinked(candidate),
      )
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    if (next && !included.has(next.id)) queue.push(next)
  }

  return result
}

/** Ripple edits retain their historical tail behavior, but stop at a break. */
export function resolveAttachedRippleTail(
  items: readonly TimelineItem[],
  anchorId: string,
): string[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const anchor = byId.get(anchorId)
  if (!anchor) return []
  const result = new Set<string>([anchorId])
  const queue: TimelineItem[] = [anchor]
  while (queue.length) {
    const current = queue.shift()!
    if (!isRippleLinked(current)) continue
    enqueueLinkedCohort(items, current, result, queue)
    enqueueRippleDownstream(items, current, result, queue)
  }
  return items.filter((item) => result.has(item.id)).map((item) => item.id)
}

export function buildAttachedMoveUpdates(
  items: readonly TimelineItem[],
  anchorId: string,
  deltaFrames: number,
  trackId?: string,
): Array<{ id: string; from: number; trackId?: string }> {
  const byId = new Map(items.map((item) => [item.id, item]))
  return resolveAttachedChain(items, anchorId).flatMap((id) => {
    const item = byId.get(id)
    if (!item) return []
    return [
      {
        id,
        from: item.from + deltaFrames,
        ...(id === anchorId && trackId ? { trackId } : {}),
      },
    ]
  })
}
