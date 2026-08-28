// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { getAudioTargetTimeSeconds } from '@/features/preview/deps/composition-runtime'
import { getSourceFrameInfo } from './edit-overlay-utils'

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 12,
    durationInFrames: 30,
    label: 'Clip 1',
    mediaId: 'media-1',
    src: 'blob:media-1',
    sourceStart: 90,
    sourceEnd: 120,
    sourceDuration: 300,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as TimelineItem
}

describe('getSourceFrameInfo', () => {
  it('maps a forward retained sourceStart update in audio-aligned time', () => {
    const info = getSourceFrameInfo(videoItem(), 15, 30)
    const audioTime = getAudioTargetTimeSeconds(90, 30, 15, 1, 30, false, 120)

    expect(info.sourceTime).toBeCloseTo(audioTime)
    expect(info.sourceFrame).toBe(105)
  })

  it('uses sourceEnd when mapping a reversed retained item', () => {
    const info = getSourceFrameInfo(videoItem({ isReversed: true }), 15, 30)
    const audioTime = getAudioTargetTimeSeconds(90, 30, 15, 1, 30, true, 120)

    expect(info.sourceTime).toBeCloseTo(audioTime)
    expect(info.sourceFrame).toBe(104)
  })

  it('derives a reversed source end from duration, speed, and source fps', () => {
    const item = videoItem({ sourceEnd: undefined, sourceFps: 60, speed: 2, isReversed: true })
    const derivedSourceEnd = 90 + (item.durationInFrames * 2 * 60) / 30
    const info = getSourceFrameInfo(item, 0, 30)
    const audioTime = getAudioTargetTimeSeconds(90, 60, 0, 2, 30, true, derivedSourceEnd)

    expect(info.sourceTime).toBeCloseTo(audioTime)
    expect(info.sourceFrame).toBe(209)
  })
})
