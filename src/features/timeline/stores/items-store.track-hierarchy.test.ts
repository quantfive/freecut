// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { useItemsStore } from './items-store'
import { resolveEffectiveTrackStates } from '../utils/group-utils'
import { preflightTimelineMutation } from '../utils/track-lock-invariants'

function storedTrackIds(): string[] {
  return useItemsStore.getState().tracks.map((track) => track.id)
}

describe('items-store track hierarchy normalization', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
  })

  it('preserves every populated group ancestor and prunes an empty sibling branch', () => {
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'outer', name: 'Outer', order: 0, isGroup: true }),
      makeTimelineTrack({
        id: 'middle',
        name: 'Middle',
        order: 1,
        isGroup: true,
        parentTrackId: 'outer',
      }),
      makeTimelineTrack({
        id: 'inner',
        name: 'Inner',
        order: 2,
        isGroup: true,
        parentTrackId: 'middle',
      }),
      makeTimelineTrack({
        id: 'empty-sibling',
        name: 'Empty sibling',
        order: 3,
        isGroup: true,
        parentTrackId: 'outer',
      }),
      makeTimelineTrack({
        id: 'lane',
        name: 'Lane',
        kind: 'video',
        order: 4,
        parentTrackId: 'inner',
      }),
    ])

    expect(storedTrackIds()).toEqual(['outer', 'middle', 'inner', 'lane'])
  })

  it('preserves a valid nested ancestry so an outer lock is inherited after setTracks', () => {
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'locked-outer',
        name: 'Locked outer',
        order: 0,
        isGroup: true,
        locked: true,
      }),
      makeTimelineTrack({
        id: 'inner',
        name: 'Inner',
        order: 1,
        isGroup: true,
        parentTrackId: 'locked-outer',
      }),
      makeTimelineTrack({
        id: 'lane',
        name: 'Lane',
        kind: 'video',
        order: 2,
        parentTrackId: 'inner',
      }),
    ])

    expect(storedTrackIds()).toEqual(['locked-outer', 'inner', 'lane'])
    expect(resolveEffectiveTrackStates(useItemsStore.getState().tracks)).toEqual([
      expect.objectContaining({ id: 'lane', locked: true }),
    ])
  })

  it('preserves a valid unlocked grandparent-to-group-to-lane ancestry after setTracks', () => {
    const item = makeTimelineVideoItem({ id: 'item', trackId: 'lane' })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'grandparent',
        name: 'Grandparent',
        order: 0,
        isGroup: true,
      }),
      makeTimelineTrack({
        id: 'group',
        name: 'Group',
        order: 1,
        isGroup: true,
        parentTrackId: 'grandparent',
      }),
      makeTimelineTrack({
        id: 'lane',
        name: 'Lane',
        kind: 'video',
        order: 2,
        parentTrackId: 'group',
      }),
    ])
    useItemsStore.getState().setItems([item])

    const { items, tracks } = useItemsStore.getState()
    expect(storedTrackIds()).toEqual(['grandparent', 'group', 'lane'])
    expect(resolveEffectiveTrackStates(tracks)).toEqual([
      expect.objectContaining({
        id: 'lane',
        locked: false,
        muted: false,
        visible: true,
        solo: false,
      }),
    ])
    expect(preflightTimelineMutation({ items, tracks, itemIds: [item.id] })).toMatchObject({
      allowed: true,
      allowedIds: [item.id],
      blockedIds: [],
    })
  })

  it('retains orphan lanes and resolves their missing ancestry fail-closed', () => {
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'orphan',
        name: 'Orphan',
        kind: 'video',
        order: 0,
        parentTrackId: 'missing-group',
      }),
    ])

    expect(storedTrackIds()).toEqual(['orphan'])
    expect(resolveEffectiveTrackStates(useItemsStore.getState().tracks)).toEqual([
      expect.objectContaining({
        id: 'orphan',
        locked: true,
        muted: true,
        visible: false,
        solo: false,
      }),
    ])
  })

  it('retains self and multi-node cycles reached by lanes and resolves them fail-closed', () => {
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'self-group',
        name: 'Self group',
        order: 0,
        isGroup: true,
        parentTrackId: 'self-group',
      }),
      makeTimelineTrack({
        id: 'self-lane',
        name: 'Self lane',
        kind: 'video',
        order: 1,
        parentTrackId: 'self-group',
      }),
      makeTimelineTrack({
        id: 'cycle-a',
        name: 'Cycle A',
        order: 2,
        isGroup: true,
        parentTrackId: 'cycle-b',
      }),
      makeTimelineTrack({
        id: 'cycle-b',
        name: 'Cycle B',
        order: 3,
        isGroup: true,
        parentTrackId: 'cycle-a',
      }),
      makeTimelineTrack({
        id: 'cycle-lane',
        name: 'Cycle lane',
        kind: 'video',
        order: 4,
        parentTrackId: 'cycle-a',
      }),
    ])

    expect(storedTrackIds()).toEqual([
      'self-group',
      'self-lane',
      'cycle-a',
      'cycle-b',
      'cycle-lane',
    ])
    expect(resolveEffectiveTrackStates(useItemsStore.getState().tracks)).toEqual([
      expect.objectContaining({ id: 'self-lane', locked: true, visible: false }),
      expect.objectContaining({ id: 'cycle-lane', locked: true, visible: false }),
    ])
  })

  it('retains duplicate parent definitions so ambiguous ancestry remains fail-closed', () => {
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'duplicate', name: 'Duplicate A', order: 0, isGroup: true }),
      makeTimelineTrack({ id: 'duplicate', name: 'Duplicate B', order: 1, isGroup: true }),
      makeTimelineTrack({
        id: 'lane',
        name: 'Lane',
        kind: 'video',
        order: 2,
        parentTrackId: 'duplicate',
      }),
    ])

    expect(storedTrackIds()).toEqual(['duplicate', 'duplicate', 'lane'])
    expect(resolveEffectiveTrackStates(useItemsStore.getState().tracks)).toEqual([
      expect.objectContaining({
        id: 'lane',
        locked: true,
        muted: true,
        visible: false,
        solo: false,
      }),
    ])
  })

  it('retains a mixed group/lane duplicate id so setTracks cannot unlock the lane', () => {
    const item = makeTimelineVideoItem({ id: 'item', trackId: 'mixed' })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'mixed', name: 'Mixed group', order: 0, isGroup: true }),
        makeTimelineTrack({ id: 'mixed', name: 'Mixed lane', kind: 'video', order: 1 }),
      ])
    useItemsStore.getState().setItems([item])

    const { items, tracks } = useItemsStore.getState()
    expect(tracks.map((track) => ({ id: track.id, isGroup: track.isGroup === true }))).toEqual([
      { id: 'mixed', isGroup: true },
      { id: 'mixed', isGroup: false },
    ])
    expect(resolveEffectiveTrackStates(tracks)).toEqual([
      expect.objectContaining({ id: 'mixed', locked: true, muted: true, visible: false }),
    ])
    expect(preflightTimelineMutation({ items, tracks, itemIds: [item.id] })).toMatchObject({
      allowed: false,
      allowedIds: [],
      blockedIds: [item.id],
    })
  })

  it('keeps duplicate lanes fail-closed through setTracks and mutation preflight', () => {
    const item = makeTimelineVideoItem({ id: 'item', trackId: 'duplicate-lane' })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({
        id: 'duplicate-lane',
        name: 'Duplicate lane A',
        kind: 'video',
        order: 0,
      }),
      makeTimelineTrack({
        id: 'duplicate-lane',
        name: 'Duplicate lane B',
        kind: 'video',
        order: 1,
      }),
    ])
    useItemsStore.getState().setItems([item])

    const { items, tracks } = useItemsStore.getState()
    expect(storedTrackIds()).toEqual(['duplicate-lane', 'duplicate-lane'])
    expect(resolveEffectiveTrackStates(tracks)).toEqual([
      expect.objectContaining({ id: 'duplicate-lane', locked: true, visible: false }),
      expect.objectContaining({ id: 'duplicate-lane', locked: true, visible: false }),
    ])
    expect(preflightTimelineMutation({ items, tracks, itemIds: [item.id] }).allowed).toBe(false)
  })

  it('fails a child lane closed when its parent id belongs to a non-group lane', () => {
    const item = makeTimelineVideoItem({ id: 'item', trackId: 'child' })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'ordinary-parent', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({
        id: 'child',
        name: 'V2',
        kind: 'video',
        order: 1,
        parentTrackId: 'ordinary-parent',
      }),
    ])
    useItemsStore.getState().setItems([item])

    const { items, tracks } = useItemsStore.getState()
    expect(storedTrackIds()).toEqual(['ordinary-parent', 'child'])
    expect(resolveEffectiveTrackStates(tracks)).toEqual([
      expect.objectContaining({ id: 'ordinary-parent', locked: false, visible: true }),
      expect.objectContaining({ id: 'child', locked: true, muted: true, visible: false }),
    ])
    expect(preflightTimelineMutation({ items, tracks, itemIds: [item.id] }).allowed).toBe(false)
  })
})
