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

  it('propagates every effective state through a nested grandparent group', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'grandparent',
        isGroup: true,
        locked: true,
        visible: false,
      }),
      makeTrack({
        id: 'parent',
        isGroup: true,
        parentTrackId: 'grandparent',
        muted: true,
        solo: true,
      }),
      makeTrack({ id: 'child', parentTrackId: 'parent' }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'child',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('resolves a deep tree without depending on input order', () => {
    const depth = 1_000
    const groups = Array.from({ length: depth }, (_, index) =>
      makeTrack({
        id: `group-${index}`,
        isGroup: true,
        parentTrackId: index === 0 ? undefined : `group-${index - 1}`,
        locked: index === 17,
        muted: index === 217,
        visible: index !== 617,
        solo: index === 917,
      }),
    )
    const child = makeTrack({ id: 'deep-child', parentTrackId: `group-${depth - 1}` })

    const [effectiveChild] = resolveEffectiveTrackStates([child, ...groups.toReversed()])

    expect(effectiveChild).toMatchObject({
      id: 'deep-child',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('fails closed when a parent track is missing', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'orphan',
        parentTrackId: 'missing-parent',
        solo: true,
      }),
    ])

    expect(effectiveChild).toMatchObject({
      locked: true,
      muted: true,
      visible: false,
      solo: false,
    })
  })

  it('fails closed for a self-parent cycle', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({ id: 'self-cycle', parentTrackId: 'self-cycle', solo: true }),
    ])

    expect(effectiveChild).toMatchObject({
      locked: true,
      muted: true,
      visible: false,
      solo: false,
    })
  })

  it('fails closed for every lane whose ancestry reaches a multi-node cycle', () => {
    const effectiveTracks = resolveEffectiveTrackStates([
      makeTrack({ id: 'group-a', isGroup: true, parentTrackId: 'group-b' }),
      makeTrack({ id: 'group-b', isGroup: true, parentTrackId: 'group-a' }),
      makeTrack({ id: 'child-a', parentTrackId: 'group-a', solo: true }),
      makeTrack({ id: 'child-b', parentTrackId: 'group-b' }),
    ])

    expect(effectiveTracks).toHaveLength(2)
    for (const effectiveTrack of effectiveTracks) {
      expect(effectiveTrack).toMatchObject({
        locked: true,
        muted: true,
        visible: false,
        solo: false,
      })
    }
  })

  it('fails closed when a lane reaches a duplicate track id', () => {
    const [effectiveTrack] = resolveEffectiveTrackStates([
      makeTrack({ id: 'duplicate-parent', isGroup: true }),
      makeTrack({ id: 'duplicate-parent', isGroup: true, locked: false }),
      makeTrack({ id: 'child', parentTrackId: 'duplicate-parent', solo: true }),
    ])

    expect(effectiveTrack).toMatchObject({
      id: 'child',
      locked: true,
      muted: true,
      visible: false,
      solo: false,
    })
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

  it('retains every transitive group ancestor in input order and prunes empty branches', () => {
    const outer = makeTrack({ id: 'outer', isGroup: true })
    const inner = makeTrack({ id: 'inner', isGroup: true, parentTrackId: outer.id })
    const emptySibling = makeTrack({
      id: 'empty-sibling',
      isGroup: true,
      parentTrackId: outer.id,
    })
    const child = makeTrack({ id: 'child', parentTrackId: inner.id })

    expect(pruneEmptyLayerGroups([child, emptySibling, inner, outer])).toEqual([
      child,
      inner,
      outer,
    ])
  })

  it('retains malformed group ancestry only when a lane reaches it', () => {
    const cycleA = makeTrack({ id: 'cycle-a', isGroup: true, parentTrackId: 'cycle-b' })
    const cycleB = makeTrack({ id: 'cycle-b', isGroup: true, parentTrackId: 'cycle-a' })
    const unreferencedCycle = makeTrack({
      id: 'unreferenced-cycle',
      isGroup: true,
      parentTrackId: 'unreferenced-cycle',
    })
    const child = makeTrack({ id: 'child', parentTrackId: cycleA.id })

    expect(pruneEmptyLayerGroups([cycleA, cycleB, unreferencedCycle, child])).toEqual([
      cycleA,
      cycleB,
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
