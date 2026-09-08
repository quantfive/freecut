import { useMemo } from 'react'
import { formatSignedFrameDelta, formatTimecodeCompact } from '@/shared/utils/time-utils'
import type { TimelineItem } from '@/types/timeline'
import { clampTrimAmount } from '../../utils/trim-utils'
import { pixelsToFrameNow } from '../../utils/zoom-conversions'

export interface ClipTrimInfoLabel {
  delta: string
  boundary?: string
  remaining?: string
  constraintLabel?: string | null
  duration: string
  side: 'start' | 'end'
}

export interface ClipReadoutLabelsInput {
  fps: number
  item?: TimelineItem
  visualLeftFrame?: number
  constraintLabel?: string | null
  isTrimming: boolean
  trimHandle: 'start' | 'end' | null
  trimDelta: number
  visualWidthFrames: number
  isDragging: boolean
  dragOffsetX: number
}

export interface ClipReadoutLabels {
  /** Delta + resulting duration shown above the dragged trim edge, or null when idle. */
  trimInfoLabel: ClipTrimInfoLabel | null
  /** Signed frame delta shown while moving a clip, or null when idle / no movement. */
  moveInfoLabel: string | null
}

/**
 * Floating readout labels for a clip during trim and move gestures.
 */
export function useClipReadoutLabels({
  fps,
  item,
  visualLeftFrame,
  constraintLabel,
  isTrimming,
  trimHandle,
  trimDelta,
  visualWidthFrames,
  isDragging,
  dragOffsetX,
}: ClipReadoutLabelsInput): ClipReadoutLabels {
  const trimInfoLabel = useMemo<ClipTrimInfoLabel | null>(() => {
    if (!isTrimming || !trimHandle) return null

    const durationDelta = trimHandle === 'start' ? -trimDelta : trimDelta
    const maxExtend = item
      ? clampTrimAmount(
          item,
          trimHandle,
          trimHandle === 'start' ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
          fps,
        ).maxExtend
      : null
    const remaining =
      maxExtend === null
        ? undefined
        : formatTimecodeCompact(
            Math.max(0, Math.round(maxExtend + (trimHandle === 'start' ? trimDelta : -trimDelta))),
            fps,
          )
    return {
      boundary:
        visualLeftFrame === undefined
          ? undefined
          : formatTimecodeCompact(
              Math.round(visualLeftFrame + (trimHandle === 'end' ? visualWidthFrames : 0)),
              fps,
            ),
      remaining,
      constraintLabel,
      delta: formatSignedFrameDelta(durationDelta, fps),
      duration: formatTimecodeCompact(Math.round(visualWidthFrames), fps),
      side: trimHandle,
    }
  }, [
    fps,
    item,
    visualLeftFrame,
    constraintLabel,
    isTrimming,
    trimDelta,
    trimHandle,
    visualWidthFrames,
  ])

  const moveInfoLabel = useMemo(() => {
    if (!isDragging) return null

    const frameDelta = pixelsToFrameNow(dragOffsetX)
    if (frameDelta === 0) return null

    return formatSignedFrameDelta(frameDelta, fps)
  }, [dragOffsetX, fps, isDragging])

  return { trimInfoLabel, moveInfoLabel }
}
