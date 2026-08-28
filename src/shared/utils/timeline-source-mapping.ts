import type { TimelineItem } from '@/types/timeline'

interface TimelineSourceMappingSignature {
  from: number
  durationInFrames: number
  sourceStart: number
  sourceEnd: number | null
  sourceDuration: number | null
  sourceFps: number | null
  speed: number
  isReversed: boolean
  reverseConformLocalStart: number
}

function getLegacySourceOffset(item: TimelineItem): number | undefined {
  return 'offset' in item ? item.offset : undefined
}

function getSourceStart(item: TimelineItem): number {
  return item.sourceStart ?? item.trimStart ?? getLegacySourceOffset(item) ?? 0
}

function getSourceFps(item: TimelineItem, timelineFps?: number): number | null {
  return item.sourceFps ?? timelineFps ?? null
}

/**
 * Canonical timeline-to-source mapping for retained media items. Optional
 * aliases and defaults are normalized so equivalent documents remain stable.
 */
function getTimelineSourceMappingSignature(
  item: TimelineItem,
  timelineFps?: number,
): TimelineSourceMappingSignature {
  return {
    from: item.from,
    durationInFrames: item.durationInFrames,
    sourceStart: getSourceStart(item),
    sourceEnd: item.sourceEnd ?? null,
    sourceDuration: item.sourceDuration ?? null,
    sourceFps: getSourceFps(item, timelineFps),
    speed: item.speed ?? 1,
    isReversed: item.isReversed === true,
    reverseConformLocalStart: item.reverseConformLocalStart ?? 0,
  }
}

export function getTimelineSourceMappingFingerprint(
  item: TimelineItem,
  timelineFps?: number,
): string {
  const mapping = getTimelineSourceMappingSignature(item, timelineFps)
  return JSON.stringify([
    mapping.from,
    mapping.durationInFrames,
    mapping.sourceStart,
    mapping.sourceEnd,
    mapping.sourceDuration,
    mapping.sourceFps,
    mapping.speed,
    mapping.isReversed,
    mapping.reverseConformLocalStart,
  ])
}

export function areTimelineSourceMappingsEqual(
  previous: TimelineItem,
  next: TimelineItem,
  timelineFps?: number,
): boolean {
  return (
    getTimelineSourceMappingFingerprint(previous, timelineFps) ===
    getTimelineSourceMappingFingerprint(next, timelineFps)
  )
}

/** Decoder/media ownership only. Source mapping is intentionally separate. */
export function getMediaSourceBindingFingerprint(item: TimelineItem): string {
  return JSON.stringify([item.mediaId ?? null, 'src' in item ? (item.src ?? null) : null])
}
