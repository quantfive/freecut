// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { findNearestAvailableSharedOffset } from './collision-utils'

describe('findNearestAvailableSharedOffset', () => {
  it('returns one nearest correction that is valid across conflicting lanes', () => {
    const offset = findNearestAvailableSharedOffset(
      [
        { trackId: 'v2', from: 20, durationInFrames: 10 },
        { trackId: 'v3', from: 50, durationInFrames: 10 },
      ],
      [
        { trackId: 'v2', from: 18, durationInFrames: 8 },
        { trackId: 'v3', from: 60, durationInFrames: 10 },
      ],
    )

    expect(offset).toBe(-12)
  })

  it('breaks equidistant ties deterministically toward the earlier offset', () => {
    expect(
      findNearestAvailableSharedOffset(
        [{ trackId: 'v1', from: 20, durationInFrames: 10 }],
        [{ trackId: 'v1', from: 15, durationInFrames: 20 }],
      ),
    ).toBe(-15)
  })

  it('honors the frame-zero lower bound when the backward edge is unreachable', () => {
    expect(
      findNearestAvailableSharedOffset(
        [{ trackId: 'v1', from: 2, durationInFrames: 10 }],
        [{ trackId: 'v1', from: 0, durationInFrames: 8 }],
      ),
    ).toBe(6)
  })

  it('accepts touching edges and an empty cohort without adding an offset', () => {
    expect(
      findNearestAvailableSharedOffset(
        [{ trackId: 'v1', from: 10, durationInFrames: 10 }],
        [
          { trackId: 'v1', from: 0, durationInFrames: 10 },
          { trackId: 'v1', from: 20, durationInFrames: 10 },
        ],
      ),
    ).toBe(0)
    expect(findNearestAvailableSharedOffset([], [])).toBe(0)
  })

  it('rejects non-finite positions and negative durations', () => {
    expect(
      findNearestAvailableSharedOffset(
        [{ trackId: 'v1', from: Number.NaN, durationInFrames: 10 }],
        [],
      ),
    ).toBeNull()
    expect(
      findNearestAvailableSharedOffset([{ trackId: 'v1', from: 0, durationInFrames: -1 }], []),
    ).toBeNull()
  })
})
