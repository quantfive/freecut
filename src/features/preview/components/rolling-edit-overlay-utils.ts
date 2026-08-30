import type { TimelineItem } from '@/types/timeline'
import { projectTrimItem } from '@/shared/timeline/trim-preview'
import { getSourceFrameInfo } from './edit-overlay-utils'

interface RollingEditPanelFramesParams {
  trimmedItem: TimelineItem
  neighborItem: TimelineItem
  handle: 'start' | 'end'
  neighborDelta: number
  fps: number
}

export function getRollingEditPanelFrames({
  trimmedItem,
  neighborItem,
  handle,
  neighborDelta,
  fps,
}: RollingEditPanelFramesParams) {
  const projectedTrimmedItem = projectTrimItem(trimmedItem, handle, neighborDelta, {
    timelineFps: fps,
  })
  const projectedNeighborItem = projectTrimItem(
    neighborItem,
    handle === 'end' ? 'start' : 'end',
    neighborDelta,
    { timelineFps: fps },
  )
  const leftItem = handle === 'end' ? projectedTrimmedItem : projectedNeighborItem
  const rightItem = handle === 'end' ? projectedNeighborItem : projectedTrimmedItem

  return {
    leftItem,
    rightItem,
    outInfo: getSourceFrameInfo(leftItem, Math.max(0, leftItem.durationInFrames - 1), fps),
    inInfo: getSourceFrameInfo(rightItem, 0, fps),
  }
}
