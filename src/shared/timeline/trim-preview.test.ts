// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { projectTrimItem, projectTrimOperation } from './trim-preview'

function makeVideo(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'clip-a',
    type: 'video',
    trackId: 'track-v1',
    from: 100,
    durationInFrames: 60,
    label: 'Clip A',
    mediaId: 'media-a',
    src: 'blob:clip-a',
    sourceStart: 30,
    sourceEnd: 90,
    sourceDuration: 180,
    sourceFps: 60,
    speed: 1,
    ...overrides,
  } as TimelineItem
}

describe('projectTrimItem', () => {
  it('keeps timeline and source domains explicit for a speed and rational FPS trim', () => {
    const item = makeVideo({ sourceStart: 30, sourceEnd: 150, durationInFrames: 60, speed: 1.5 })
    const projected = projectTrimItem(item, 'start', 10, {
      timelineFps: 30000 / 1001,
    })

    expect(projected).toMatchObject({
      from: 110,
      durationInFrames: 50,
      sourceStart: 60,
      sourceEnd: 150,
    })
    expect(item).toMatchObject({
      from: 100,
      durationInFrames: 60,
      sourceStart: 30,
      sourceEnd: 150,
    })
  })

  it('moves the reverse source boundary for start and end trims', () => {
    const item = makeVideo({
      isReversed: true,
      sourceStart: 30,
      sourceEnd: 150,
      sourceFps: 30,
    })

    expect(projectTrimItem(item, 'start', 10)).toMatchObject({
      from: 110,
      durationInFrames: 50,
      sourceStart: 30,
      sourceEnd: 140,
    })
    expect(projectTrimItem(item, 'end', 10)).toMatchObject({
      from: 100,
      durationInFrames: 70,
      sourceStart: 20,
      sourceEnd: 150,
    })
  })

  it('clamps projected source bounds without mutating the authoritative item', () => {
    const item = makeVideo({ sourceStart: 2, sourceEnd: 20, sourceDuration: 20 })
    const projected = projectTrimItem(item, 'start', -10)

    expect(projected.sourceStart).toBe(0)
    expect(projected.from).toBe(99)
    expect(projected.durationInFrames).toBe(61)
    expect(item.sourceStart).toBe(2)
  })
})

describe('projectTrimOperation', () => {
  it('anchors ripple start trims and shifts downstream items by the timeline delta', () => {
    const anchor = makeVideo({ id: 'anchor', from: 100, durationInFrames: 60, sourceFps: 30 })
    const downstream = makeVideo({
      id: 'downstream',
      from: 180,
      durationInFrames: 30,
      sourceFps: 30,
    })

    const projection = projectTrimOperation({
      items: [anchor, downstream],
      itemId: anchor.id,
      handle: 'start',
      mode: 'ripple',
      deltaFrames: 10,
      downstreamItemIds: ['downstream'],
    })

    expect(projection?.timeline).toMatchObject({
      editPointBeforeFrame: 100,
      editPointAfterFrame: 100,
      rippleShiftFrames: -10,
    })
    expect(projection?.timeline.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anchor',
          from: 100,
          durationInFrames: 50,
          sourceStart: 40,
        }),
        expect.objectContaining({ id: 'downstream', from: 170, durationInFrames: 30 }),
      ]),
    )
    expect(projection?.source.boundaries).toEqual([
      expect.objectContaining({
        itemId: 'anchor',
        before: { start: 30, end: 90 },
        after: { start: 40, end: 90 },
      }),
    ])
  })

  it('projects a rolling cut as one atomic pair', () => {
    const left = makeVideo({ id: 'left', from: 0, durationInFrames: 100, sourceStart: 0 })
    const right = makeVideo({ id: 'right', from: 100, durationInFrames: 80, sourceStart: 40 })

    const projection = projectTrimOperation({
      items: [left, right],
      itemId: 'right',
      neighborId: 'left',
      handle: 'start',
      mode: 'rolling',
      deltaFrames: 12,
    })

    expect(projection?.timeline.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'left', from: 0, durationInFrames: 112 }),
        expect.objectContaining({ id: 'right', from: 112, durationInFrames: 68 }),
      ]),
    )
    expect(projection?.timeline.editPointAfterFrame).toBe(112)
  })
})
