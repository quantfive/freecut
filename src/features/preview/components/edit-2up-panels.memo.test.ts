// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { VideoFrame } from './edit-2up-panels'

type VideoFrameMemoComparator = (
  previous: { item: TimelineItem; sourceTime: number },
  next: { item: TimelineItem; sourceTime: number },
) => boolean

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Clip 1',
    mediaId: 'media-1',
    src: 'blob:media-1',
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 300,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as TimelineItem
}

const compare = (VideoFrame as unknown as { compare: VideoFrameMemoComparator }).compare

describe('VideoFrame memo source mapping', () => {
  it.each([
    ['sourceStart', { sourceStart: 90 }],
    ['sourceEnd', { sourceEnd: 120 }],
    ['sourceFps', { sourceFps: 60 }],
    ['speed', { speed: 2 }],
    ['reverse', { isReversed: true }],
    ['timeline start', { from: 12 }],
    ['timeline duration', { durationInFrames: 24 }],
  ])('rerenders when %s changes at the same sourceTime', (_name, overrides) => {
    const previous = { item: videoItem(), sourceTime: 15 }
    const next = { item: videoItem(overrides as Partial<TimelineItem>), sourceTime: 15 }

    expect(compare(previous, next)).toBe(false)
  })

  it('keeps an unchanged source mapping memo-stable', () => {
    const previous = { item: videoItem(), sourceTime: 15 }
    const next = { item: videoItem(), sourceTime: 15 }

    expect(compare(previous, next)).toBe(true)
  })
})
