import type { TimelineItem, TimelineState } from './contract'

function itemId(item: TimelineItem): string {
  return item.item_type === 'caption_cue' ? item.cue_id : item.item_id
}

function start(item: TimelineItem): number {
  return item.item_type === 'caption_cue' ? item.start_us : item.timeline_start_us
}

function end(item: TimelineItem): number {
  return item.item_type === 'caption_cue' ? item.end_us : item.timeline_end_us
}

function attached(item: TimelineItem): boolean {
  return item.ripple_linked !== false
}

/** Neutral-wire counterpart of the frame-native attachment resolver. */
export function resolveAttachedChainIds(timeline: TimelineState, anchorId: string): string[] {
  const items = timeline.tracks.flatMap((track) => track.items)
  const byId = new Map(items.map((item) => [itemId(item), item]))
  const anchor = byId.get(anchorId)
  if (!anchor) return []
  const result: string[] = []
  const seen = new Set<string>()
  const queue: TimelineItem[] = [anchor]
  while (queue.length) {
    const current = queue.shift()!
    const currentId = itemId(current)
    if (seen.has(currentId)) continue
    seen.add(currentId)
    result.push(currentId)
    if (current.item_type !== 'caption_cue' && current.linked_group_id) {
      for (const cohort of items) {
        if (cohort.linked_group_id === current.linked_group_id && !seen.has(itemId(cohort)))
          queue.push(cohort)
      }
    }
    if (!attached(current)) continue
    const currentTrack = current.track_id
    const next = items.find(
      (candidate) =>
        candidate.track_id === currentTrack &&
        itemId(candidate) !== currentId &&
        start(candidate) === end(current) &&
        attached(candidate),
    )
    if (next && !seen.has(itemId(next))) queue.push(next)
  }
  return result
}
