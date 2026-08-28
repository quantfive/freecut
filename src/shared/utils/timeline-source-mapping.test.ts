// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  areTimelineSourceMappingsEqual,
  getMediaSourceBindingFingerprint,
} from './timeline-source-mapping'

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 10,
    durationInFrames: 60,
    label: 'Clip',
    mediaId: 'media-1',
    src: 'blob:media-1',
    sourceStart: 5,
    sourceEnd: 65,
    sourceDuration: 120,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as TimelineItem
}

describe('timeline source mapping identity', () => {
  it.each([
    ['from', { from: 12 }],
    ['duration', { durationInFrames: 50 }],
    ['sourceStart', { sourceStart: 6 }],
    ['sourceEnd', { sourceEnd: 66 }],
    ['sourceDuration', { sourceDuration: 240 }],
    ['sourceFps', { sourceFps: 60 }],
    ['speed', { speed: 1.25 }],
    ['reverse', { isReversed: true }],
    ['reverse conform offset', { reverseConformLocalStart: 4 }],
  ])('changes for %s', (_name, overrides) => {
    expect(areTimelineSourceMappingsEqual(videoItem(), videoItem(overrides))).toBe(false)
  })

  it('normalizes source-start aliases and default values', () => {
    const canonical = videoItem({ sourceStart: 5, speed: 1, isReversed: false })
    const legacy = videoItem({
      sourceStart: undefined,
      trimStart: undefined,
      offset: 5,
      speed: undefined,
    })

    expect(areTimelineSourceMappingsEqual(canonical, legacy)).toBe(true)
  })

  it('ignores transform-only changes for decoded-source reuse', () => {
    expect(
      areTimelineSourceMappingsEqual(
        videoItem(),
        videoItem({ transform: { x: 20, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 } }),
      ),
    ).toBe(true)
  })

  it('keeps media binding distinct from source mapping', () => {
    expect(getMediaSourceBindingFingerprint(videoItem())).toBe(
      getMediaSourceBindingFingerprint(videoItem()),
    )
    expect(getMediaSourceBindingFingerprint(videoItem({ src: 'blob:media-2' }))).not.toBe(
      getMediaSourceBindingFingerprint(videoItem()),
    )
  })
})
