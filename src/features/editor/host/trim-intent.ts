import type {
  EditCommand,
  EditCommandBatch,
  FreeCutFrameDocument,
  FreeCutFrameItem,
} from '@/features/editor/codepress'
import { framesToMicroseconds } from '@/features/editor/codepress/timing'

/** Frame deltas are quantized once, at the command boundary. */
export interface HostTrimIntent {
  handle: 'start' | 'end'
  deltaFrames: number
  mode: 'normal' | 'ripple' | 'rolling'
  itemIds: readonly string[]
  neighborId?: string | null
}

export function trimIntentBatch(
  document: FreeCutFrameDocument,
  anchorId: string,
  intent: HostTrimIntent,
): EditCommandBatch {
  const all = document.tracks.flatMap((track) => track.items)
  const anchor = all.find((item) => item.id === anchorId)
  if (!anchor) throw new Error('This clip was removed. Select a current clip and try again.')
  if (!Number.isSafeInteger(intent.deltaFrames))
    throw new Error('The trim must end on a timeline frame.')
  const ids = new Set(intent.itemIds)
  if (ids.size !== 1 || !ids.has(anchorId))
    throw new Error('Trim one clip at a time. The selected cohort was not changed.')
  const commands: EditCommand[] = []
  const touched = new Map<string, FreeCutFrameItem>()
  const assertEditable = (item: FreeCutFrameItem) => {
    if (item.linkedGroupId)
      throw new Error(
        'Linked clip trimming is not supported by the host yet. No clips were changed.',
      )
    let track = document.tracks.find((candidate) => candidate.id === item.trackId)
    const seen = new Set<string>()
    while (track && !seen.has(track.id)) {
      seen.add(track.id)
      if (track.locked)
        throw new Error('Unlock the affected track before trimming. No clips were changed.')
      track = document.tracks.find((candidate) => candidate.id === track?.parentTrackId)
    }
    touched.set(item.id, item)
  }
  const trim = (item: FreeCutFrameItem, edge: 'start' | 'end') => {
    assertEditable(item)
    if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')
      throw new Error('This item does not support source trimming.')
    const delta = intent.deltaFrames
    const sourceStart = item.sourceStart ?? 0
    const sourceEnd = item.sourceEnd ?? sourceStart + item.durationInFrames
    const speed = item.speed ?? 1
    const source = (edge === 'start' ? sourceStart : sourceEnd) + Math.round(delta * speed)
    if (source < 0) throw new Error('This trim exceeds the available source handles.')
    commands.push({
      command_id: `trim-${item.id}`,
      type: 'trim_item',
      item_id: item.id,
      edge,
      timeline_us: framesToMicroseconds(
        (edge === 'start' ? item.from : item.from + item.durationInFrames) + delta,
        document.fps,
      ),
      source_us: framesToMicroseconds(source, document.fps),
    })
  }
  const move = (item: FreeCutFrameItem, from: number) => {
    assertEditable(item)
    commands.push({
      command_id: `move-${item.id}`,
      type: 'move_item',
      item_id: item.id,
      to_track_id: item.trackId,
      timeline_start_us: framesToMicroseconds(from, document.fps),
      index: document.tracks
        .find((track) => track.id === item.trackId)!
        .items.findIndex((candidate) => candidate.id === item.id),
    })
  }
  trim(anchor, intent.handle)
  if (intent.mode === 'rolling') {
    const neighbor = all.find((item) => item.id === intent.neighborId)
    if (
      !neighbor ||
      neighbor.trackId !== anchor.trackId ||
      (intent.handle === 'end'
        ? anchor.from + anchor.durationInFrames !== neighbor.from
        : neighbor.from + neighbor.durationInFrames !== anchor.from)
    ) {
      throw new Error('The adjacent cut changed. Review the cut and try again.')
    }
    trim(neighbor, intent.handle === 'start' ? 'end' : 'start')
  } else if (intent.mode === 'ripple') {
    if (document.tracks.some((track) => track.id !== anchor.trackId && track.syncLock)) {
      throw new Error(
        'This trim affects synchronized tracks. Use a supported sequence edit; no clips were changed.',
      )
    }
    const shift = intent.handle === 'start' ? -intent.deltaFrames : intent.deltaFrames
    if (intent.handle === 'start') move(anchor, anchor.from)
    // Respect durable attachment breaks, including a detached anchor. Gaps
    // before the break retain their width, matching the existing ripple tool.
    if (anchor.rippleLinked !== false) {
      const tail = all
        .filter(
          (item) =>
            item.trackId === anchor.trackId && item.from >= anchor.from + anchor.durationInFrames,
        )
        .sort((a, b) => a.from - b.from)
      for (const item of tail) {
        if (item.rippleLinked === false) break
        move(item, item.from + shift)
      }
    }
  }
  if (commands.length > 64)
    throw new Error('This trim exceeds the host operation limit. No clips were changed.')
  return {
    contract_version: 1,
    timeline_id: document.timelineId,
    base_revision: document.revision,
    operation_id: `op-${crypto.randomUUID()}`,
    idempotency_key: `idem-${crypto.randomUUID()}`,
    commands,
    preconditions: [...touched.values()].map((item) => ({
      type: 'item_at' as const,
      item_id: item.id,
      track_id: item.trackId,
      timeline_start_us: framesToMicroseconds(item.from, document.fps),
      timeline_end_us: framesToMicroseconds(item.from + item.durationInFrames, document.fps),
    })),
  }
}
