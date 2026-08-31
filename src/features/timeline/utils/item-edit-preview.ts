import type { TimelineItem } from '@/types/timeline'
import { projectTrimItem } from '@/shared/timeline/trim-preview'
import { isMediaItem, timelineToSourceFrames } from './source-calculations'

export interface PreviewItemUpdate {
  id: string
  from?: number
  durationInFrames?: number
  sourceStart?: number
  sourceEnd?: number
  speed?: number
  hidden?: boolean
}

function toTrimPreviewUpdate(item: TimelineItem, projected: TimelineItem): PreviewItemUpdate {
  const update: PreviewItemUpdate = { id: item.id }

  if (projected.from !== item.from) update.from = projected.from
  if (projected.durationInFrames !== item.durationInFrames) {
    update.durationInFrames = projected.durationInFrames
  }
  if (projected.sourceStart !== item.sourceStart || item.sourceStart !== undefined) {
    update.sourceStart = projected.sourceStart
  }
  if (projected.sourceEnd !== item.sourceEnd || item.sourceEnd !== undefined) {
    update.sourceEnd = projected.sourceEnd
  }

  return update
}

export function applyTrimStartPreview(
  item: TimelineItem,
  trimDelta: number,
  fps: number,
): PreviewItemUpdate {
  return toTrimPreviewUpdate(item, projectTrimItem(item, 'start', trimDelta, { timelineFps: fps }))
}

export function applyTrimEndPreview(
  item: TimelineItem,
  trimDelta: number,
  fps: number,
): PreviewItemUpdate {
  return toTrimPreviewUpdate(item, projectTrimItem(item, 'end', trimDelta, { timelineFps: fps }))
}

export function applyMovePreview(item: TimelineItem, fromDelta: number): PreviewItemUpdate {
  return {
    id: item.id,
    from: item.from + fromDelta,
  }
}

export function applySlidePreview(
  item: TimelineItem,
  slideDelta: number,
  sourceDelta: number,
): PreviewItemUpdate {
  const update = applyMovePreview(item, slideDelta)
  if (sourceDelta === 0 || !isMediaItem(item) || item.sourceEnd === undefined) return update

  return {
    ...update,
    sourceStart: (item.sourceStart ?? 0) + sourceDelta,
    sourceEnd: item.sourceEnd + sourceDelta,
  }
}

export function applySlipPreview(item: TimelineItem, slipDelta: number): PreviewItemUpdate {
  if (
    (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') ||
    item.sourceEnd === undefined
  ) {
    return { id: item.id }
  }

  return {
    id: item.id,
    sourceStart: (item.sourceStart ?? 0) + slipDelta,
    sourceEnd: item.sourceEnd + slipDelta,
  }
}

export function applyRateStretchPreview(
  item: TimelineItem,
  newFrom: number,
  newDuration: number,
  newSpeed: number,
  timelineFps: number,
): PreviewItemUpdate {
  const update: PreviewItemUpdate = {
    id: item.id,
    from: newFrom,
    durationInFrames: newDuration,
    speed: newSpeed,
  }

  const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition' && !isGif) {
    return update
  }

  const hasExplicitSourceBounds =
    (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
    item.sourceEnd !== undefined

  if (
    !hasExplicitSourceBounds &&
    (item.type === 'video' || item.type === 'audio' || item.type === 'composition')
  ) {
    const sourceStart = item.sourceStart ?? 0
    const sourceFps = item.sourceFps ?? timelineFps
    const sourceFramesNeeded = timelineToSourceFrames(newDuration, newSpeed, timelineFps, sourceFps)
    update.sourceEnd = sourceStart + sourceFramesNeeded
  }

  return update
}
