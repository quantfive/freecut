// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import {
  getVisibleTrackIds,
  pruneEmptyLayerGroupHierarchy,
  pruneEmptyLayerGroups,
  resolveEffectiveTrackStates,
} from './group-utils'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    kind: 'video',
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

describe('group-utils', () => {
  it('filters out group container tracks while preserving child ordering', () => {
    const tracks = resolveEffectiveTrackStates([
      makeTrack({ id: 'group-1', isGroup: true, order: 0 }),
      makeTrack({ id: 'child-1', parentTrackId: 'group-1', order: 1 }),
      makeTrack({ id: 'child-2', order: 2 }),
    ])

    expect(tracks.map((track) => track.id)).toEqual(['child-1', 'child-2'])
  })

  it('propagates parent layer-group mute, visibility, lock, and solo state to children', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'group-1',
        isGroup: true,
        locked: true,
        muted: true,
        visible: false,
        solo: true,
      }),
      makeTrack({
        id: 'child-1',
        parentTrackId: 'group-1',
      }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'child-1',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('propagates every effective property through arbitrarily deep group ancestry', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'outer-group',
        isGroup: true,
        locked: true,
      }),
      makeTrack({
        id: 'middle-group',
        isGroup: true,
        parentTrackId: 'outer-group',
        muted: true,
      }),
      makeTrack({
        id: 'inner-group',
        isGroup: true,
        parentTrackId: 'middle-group',
        visible: false,
        solo: true,
      }),
      makeTrack({
        id: 'deep-child',
        parentTrackId: 'inner-group',
      }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'deep-child',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('fails closed for a missing declared parent without changing other effective properties', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'orphaned-child',
        parentTrackId: 'missing-group',
        muted: true,
        visible: true,
        solo: false,
      }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'orphaned-child',
      locked: true,
      muted: true,
      visible: true,
      solo: false,
    })
  })

  it('terminates parent cycles deterministically and fails the cycle closed for locking', () => {
    const cycleTracks = [
      makeTrack({
        id: 'group-a',
        isGroup: true,
        parentTrackId: 'group-b',
        muted: true,
      }),
      makeTrack({
        id: 'group-b',
        isGroup: true,
        parentTrackId: 'group-a',
        visible: false,
        solo: true,
      }),
      makeTrack({ id: 'cycle-child', parentTrackId: 'group-a' }),
    ]

    const [forwardResult] = resolveEffectiveTrackStates(cycleTracks)
    const [reverseResult] = resolveEffectiveTrackStates(cycleTracks.toReversed())

    expect(forwardResult).toMatchObject({
      id: 'cycle-child',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
    expect(reverseResult).toEqual(forwardResult)
  })

  it('uses propagated visibility when collecting visible track ids', () => {
    const visibleTrackIds = getVisibleTrackIds([
      makeTrack({ id: 'group-1', isGroup: true, visible: false }),
      makeTrack({ id: 'child-hidden', parentTrackId: 'group-1', visible: true }),
      makeTrack({ id: 'child-visible', visible: true }),
    ])

    expect(visibleTrackIds).toEqual(new Set(['child-visible']))
  })

  it('prunes empty layer groups while retaining populated groups and their children', () => {
    const populatedGroup = makeTrack({ id: 'group-populated', isGroup: true })
    const emptyGroup = makeTrack({ id: 'group-empty', isGroup: true })
    const child = makeTrack({ id: 'child', parentTrackId: populatedGroup.id })

    expect(pruneEmptyLayerGroups([populatedGroup, emptyGroup, child])).toEqual([
      populatedGroup,
      child,
    ])
  })

  it('prunes empty child lanes without removing empty top-level classic tracks', () => {
    const group = makeTrack({ id: 'group', isGroup: true })
    const populatedChild = makeTrack({ id: 'child-populated', parentTrackId: group.id })
    const emptyChild = makeTrack({ id: 'child-empty', parentTrackId: group.id })
    const emptyClassicTrack = makeTrack({ id: 'classic-empty' })

    expect(
      pruneEmptyLayerGroupHierarchy(
        [group, populatedChild, emptyChild, emptyClassicTrack],
        [{ trackId: populatedChild.id }],
      ),
    ).toEqual([group, populatedChild, emptyClassicTrack])
  })
})
