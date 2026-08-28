import type { TimelineItem } from '@/types/timeline'
import { getVideoTargetTimeSeconds } from '@/features/preview/deps/composition-runtime'
import { formatTimecode } from '@/shared/utils/time-utils'

export interface SourceFrameInfo {
  sourceTime: number
  sourceFrame: number
  sourceFps: number
  timecode: string
}

export function getSourceFrameInfo(
  item: TimelineItem,
  localFrame: number,
  timelineFps: number,
): SourceFrameInfo {
  const sourceFps = item.sourceFps ?? timelineFps
  const sourceRate = item.speed ?? 1
  const legacyOffset = 'offset' in item ? item.offset : undefined
  const sourceStart = item.sourceStart ?? item.trimStart ?? legacyOffset ?? 0
  const derivedSourceEnd =
    sourceStart + (item.durationInFrames * sourceRate * sourceFps) / timelineFps
  const reverseSourceEnd = item.sourceEnd ?? derivedSourceEnd

  const sourceTime = getVideoTargetTimeSeconds(
    sourceStart,
    sourceFps,
    localFrame,
    sourceRate,
    timelineFps,
    0,
    item.isReversed === true,
    reverseSourceEnd,
  )
  const sourceFrame = Math.max(0, Math.round(sourceTime * sourceFps))

  return {
    sourceTime,
    sourceFrame,
    sourceFps,
    timecode: formatTimecode(sourceFrame, sourceFps),
  }
}
