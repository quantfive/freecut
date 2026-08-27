// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { LottieItem, TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import {
  insertFreezeFrame,
  joinItems,
  rateStretchItem,
  rateStretchItemWithoutHistory,
  removeSilenceFromItems,
  resetSpeedWithRipple,
  rippleTrimItem,
  rollingTrimItems,
  slideItem,
  slipItem,
  splitAllItemsAtFrame,
  splitItem,
  splitItemAtFrames,
  trimItemBreakingTransition,
  trimItemEnd,
  trimItemStart,
} from './item-edit-actions'
import { updateItem } from './item-actions'
import { preflightTimelineMutation } from '../../utils/track-lock-invariants'

function tracks(overrides: Partial<TimelineTrack> = {}): TimelineTrack[] {
  return [
    makeTimelineTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
      ...overrides,
    }),
    makeTimelineTrack({ id: 'audio-track', name: 'A1', kind: 'audio', order: 1 }),
    makeTimelineTrack({ id: 'caption-track', name: 'Captions', order: 2 }),
  ]
}

function video(overrides: Partial<Extract<TimelineItem, { type: 'video' }>> = {}) {
  return makeTimelineVideoItem({
    id: 'middle',
    trackId: 'video-track',
    from: 60,
    durationInFrames: 60,
    sourceStart: 30,
    sourceEnd: 90,
    sourceDuration: 180,
    ...overrides,
  })
}

function transition(): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'middle',
    trackId: 'video-track',
    durationInFrames: 10,
  }
}

function snapshot() {
  return {
    items: structuredClone(useItemsStore.getState().items),
    tracks: structuredClone(useItemsStore.getState().tracks),
    transitions: structuredClone(useTransitionsStore.getState().transitions),
    keyframes: structuredClone(useKeyframesStore.getState().keyframes),
    undoDepth: useTimelineCommandStore.getState().undoStack.length,
    redoDepth: useTimelineCommandStore.getState().redoStack.length,
    dirty: useTimelineSettingsStore.getState().isDirty,
    selection: structuredClone(useSelectionStore.getState().selectedItemIds),
  }
}

function expectUnchanged(before: ReturnType<typeof snapshot>): void {
  expect(useItemsStore.getState().items).toEqual(before.items)
  expect(useItemsStore.getState().tracks).toEqual(before.tracks)
  expect(useTransitionsStore.getState().transitions).toEqual(before.transitions)
  expect(useKeyframesStore.getState().keyframes).toEqual(before.keyframes)
  expect(useTimelineCommandStore.getState().undoStack).toHaveLength(before.undoDepth)
  expect(useTimelineCommandStore.getState().redoStack).toHaveLength(before.redoDepth)
  expect(useTimelineSettingsStore.getState().isDirty).toBe(before.dirty)
  expect(useSelectionStore.getState().selectedItemIds).toEqual(before.selection)
}

describe('public item edit lock preflights', () => {
  beforeEach(() => {
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useSelectionStore.getState().clearSelection()
    useItemsStore.getState().setTracks(tracks())
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  })

  it.each([
    ['normal trim start', () => trimItemStart('middle', 10)],
    ['normal trim end', () => trimItemEnd('middle', -10)],
    ['ripple trim', () => rippleTrimItem('middle', 'end', -10)],
    ['rolling trim', () => rollingTrimItems('left', 'middle', 10)],
    ['slip', () => slipItem('middle', 10)],
    ['slide', () => slideItem('middle', 10, 'left', 'right')],
  ])('rejects %s before any item, transition, dirty, or history change', (_name, action) => {
    useItemsStore.getState().setTracks(tracks({ locked: true }))
    useItemsStore
      .getState()
      .setItems([
        video({ id: 'left', from: 0, sourceStart: 0, sourceEnd: 60 }),
        video(),
        video({ id: 'right', from: 120, sourceStart: 60, sourceEnd: 120 }),
      ])
    useTransitionsStore.getState().setTransitions([transition()])
    const before = snapshot()

    action()

    expectUnchanged(before)
  })

  it('preflights a transition-breaking trim before removing the transition', () => {
    useItemsStore.getState().setTracks(tracks({ locked: true }))
    useItemsStore
      .getState()
      .setItems([video({ id: 'left', from: 0, sourceStart: 0, sourceEnd: 60 }), video()])
    useTransitionsStore.getState().setTransitions([transition()])
    const before = snapshot()

    trimItemBreakingTransition('middle', 'start', 10, ['transition-1'])

    expectUnchanged(before)
  })

  it.each([
    [
      'mixed group/lane duplicate id',
      [
        makeTimelineTrack({
          id: 'video-track',
          name: 'Ambiguous group',
          order: 0,
          isGroup: true,
        }),
        makeTimelineTrack({
          id: 'video-track',
          name: 'Ambiguous lane',
          kind: 'video',
          order: 1,
        }),
      ],
    ],
    [
      'duplicate groups',
      [
        makeTimelineTrack({ id: 'group', name: 'Group A', order: 0, isGroup: true }),
        makeTimelineTrack({ id: 'group', name: 'Group B', order: 1, isGroup: true }),
        makeTimelineTrack({
          id: 'video-track',
          name: 'Lane',
          kind: 'video',
          order: 2,
          parentTrackId: 'group',
        }),
      ],
    ],
    [
      'duplicate lanes',
      [
        makeTimelineTrack({ id: 'video-track', name: 'Lane A', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'video-track', name: 'Lane B', kind: 'video', order: 1 }),
      ],
    ],
    [
      'missing parent',
      [
        makeTimelineTrack({
          id: 'video-track',
          name: 'Lane',
          kind: 'video',
          order: 0,
          parentTrackId: 'missing',
        }),
      ],
    ],
    [
      'non-group parent',
      [
        makeTimelineTrack({ id: 'ordinary-parent', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({
          id: 'video-track',
          name: 'V2',
          kind: 'video',
          order: 1,
          parentTrackId: 'ordinary-parent',
        }),
      ],
    ],
    [
      'self-parent',
      [
        makeTimelineTrack({
          id: 'video-track',
          name: 'Lane',
          kind: 'video',
          order: 0,
          parentTrackId: 'video-track',
        }),
      ],
    ],
    [
      'multi-node cycle',
      [
        makeTimelineTrack({
          id: 'group-a',
          name: 'Group A',
          order: 0,
          isGroup: true,
          parentTrackId: 'group-b',
        }),
        makeTimelineTrack({
          id: 'group-b',
          name: 'Group B',
          order: 1,
          isGroup: true,
          parentTrackId: 'group-a',
        }),
        makeTimelineTrack({
          id: 'video-track',
          name: 'Lane',
          kind: 'video',
          order: 2,
          parentTrackId: 'group-a',
        }),
      ],
    ],
  ] as const)('rejects trim atomically for malformed ancestry: %s', (_name, malformedTracks) => {
    useItemsStore.getState().setTracks([...malformedTracks])
    useItemsStore.getState().setItems([video()])
    useSelectionStore.getState().selectItems(['middle'])
    const before = snapshot()
    const { items, tracks: storedTracks } = useItemsStore.getState()

    expect(
      preflightTimelineMutation({ items, tracks: storedTracks, itemIds: ['middle'] }),
    ).toMatchObject({ allowed: false, allowedIds: [], blockedIds: ['middle'] })

    trimItemStart('middle', 10)

    expectUnchanged(before)
  })

  it.each([true, false])(
    'rejects the live-QA linked A/V trim and split when linked selection is %s',
    (linkedSelectionEnabled) => {
      useEditorStore.setState({ linkedSelectionEnabled })
      useItemsStore.getState().setTracks([
        tracks()[0]!,
        makeTimelineTrack({
          id: 'audio-track',
          name: 'A1',
          kind: 'audio',
          order: 1,
          locked: true,
        }),
      ])
      useItemsStore.getState().setItems([
        video({ linkedGroupId: 'linked-av' }),
        makeTimelineAudioItem({
          id: 'audio',
          trackId: 'audio-track',
          from: 60,
          durationInFrames: 60,
          sourceStart: 30,
          sourceEnd: 90,
          sourceDuration: 180,
          linkedGroupId: 'linked-av',
        }),
      ])
      const before = snapshot()

      trimItemEnd('middle', -10)
      expect(splitItem('middle', 90)).toBeNull()

      expectUnchanged(before)
    },
  )

  it('rejects every split entry point and join on an effectively locked group child', () => {
    const group = makeTimelineTrack({
      id: 'group',
      name: 'Locked Group',
      order: 0,
      isGroup: true,
      locked: true,
    })
    const child = makeTimelineTrack({
      id: 'video-track',
      name: 'Layer',
      order: 1,
      kind: 'video',
      parentTrackId: group.id,
    })
    useItemsStore.getState().setTracks([group, child])
    useItemsStore
      .getState()
      .setItems([
        video({ id: 'left', from: 0, durationInFrames: 60 }),
        video({ id: 'right', from: 60, durationInFrames: 60 }),
      ])
    const before = snapshot()

    expect(splitItem('left', 30)).toBeNull()
    expect(splitAllItemsAtFrame(30)).toBe(0)
    expect(splitItemAtFrames('left', [20, 40])).toBe(0)
    joinItems(['left', 'right'])

    expectUnchanged(before)
  })

  it('rejects rate stretch, reset-speed ripple, and freeze-frame insertion atomically', async () => {
    useItemsStore.getState().setTracks(tracks({ locked: true }))
    useItemsStore.getState().setItems([video({ speed: 2 }), video({ id: 'right', from: 120 })])
    const before = snapshot()

    rateStretchItem('middle', 60, 90, 1)
    rateStretchItemWithoutHistory('middle', 60, 90, 1)
    resetSpeedWithRipple(['middle'])
    await expect(insertFreezeFrame('middle', 90)).resolves.toBe(false)

    expectUnchanged(before)
  })

  it('rejects range removal before its first split when a linked companion is locked', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useItemsStore.getState().setTracks([
      tracks()[0]!,
      makeTimelineTrack({
        id: 'audio-track',
        name: 'A1',
        kind: 'audio',
        order: 1,
        locked: true,
      }),
    ])
    useItemsStore.getState().setItems([
      video({ id: 'video', from: 0, linkedGroupId: 'linked-av' }),
      makeTimelineAudioItem({
        id: 'audio',
        trackId: 'audio-track',
        linkedGroupId: 'linked-av',
        sourceStart: 30,
        sourceEnd: 90,
        sourceDuration: 180,
      }),
    ])
    const before = snapshot()

    const result = removeSilenceFromItems(['video'], {
      'media-1': [{ start: 1.5, end: 2 }],
    })

    expect(result).toMatchObject({ removedItemCount: 0, splitCount: 0 })
    expectUnchanged(before)
  })

  it('allows normal trim when a locked attached caption remains wholly within final bounds', () => {
    const caption: TextItem = {
      id: 'caption',
      type: 'text',
      trackId: 'caption-track',
      from: 70,
      durationInFrames: 10,
      label: 'Caption',
      text: 'Caption',
      color: '#fff',
      textRole: 'caption',
      captionSource: { type: 'transcript', clipId: 'middle', mediaId: 'media-1' },
    }
    useItemsStore.getState().setTracks([
      tracks()[0]!,
      makeTimelineTrack({
        id: 'caption-track',
        name: 'Captions',
        order: 1,
        locked: true,
      }),
    ])
    useItemsStore.getState().setItems([video(), caption])

    trimItemEnd('middle', -30)

    expect(useItemsStore.getState().itemById.middle).toMatchObject({ durationInFrames: 30 })
    expect(useItemsStore.getState().itemById.caption).toEqual(caption)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })

  it.each([
    ['crossing', 80, 20],
    ['removed', 100, 30],
  ] as const)(
    'rejects normal trim when a locked attached caption would be %s',
    (_case, from, durationInFrames) => {
      const caption: TextItem = {
        id: 'caption',
        type: 'text',
        trackId: 'caption-track',
        from,
        durationInFrames,
        label: 'Caption',
        text: 'Caption',
        color: '#fff',
        textRole: 'caption',
        captionSource: { type: 'transcript', clipId: 'middle', mediaId: 'media-1' },
      }
      useItemsStore.getState().setTracks([
        tracks()[0]!,
        makeTimelineTrack({
          id: 'caption-track',
          name: 'Captions',
          order: 1,
          locked: true,
        }),
      ])
      useItemsStore.getState().setItems([video(), caption])
      const before = snapshot()

      trimItemEnd('middle', -30)

      expectUnchanged(before)
    },
  )

  it.each([
    ['reversed', { reversed: true }],
    ['segmentStart', { segmentStart: 12 }],
    ['segmentEnd', { segmentEnd: 48 }],
  ] as const)('protects the Lottie %s field on locked tracks', (_field, updates) => {
    const lottie: LottieItem = {
      id: 'lottie',
      type: 'lottie',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 60,
      label: 'Animation',
      src: 'blob:lottie',
      frameRate: 30,
      totalFrames: 60,
    }
    useItemsStore.getState().setTracks(tracks({ locked: true }))
    useItemsStore.getState().setItems([lottie])
    const before = snapshot()

    updateItem('lottie', updates)

    expectUnchanged(before)
  })

  it('allows Lottie timing controls on an unlocked standalone item', () => {
    const lottie: LottieItem = {
      id: 'lottie',
      type: 'lottie',
      trackId: 'video-track',
      from: 0,
      durationInFrames: 60,
      label: 'Animation',
      src: 'blob:lottie',
      frameRate: 30,
      totalFrames: 60,
    }
    useItemsStore.getState().setItems([lottie])

    updateItem('lottie', { reversed: true, segmentStart: 12, segmentEnd: 48 })

    expect(useItemsStore.getState().itemById.lottie).toMatchObject({
      reversed: true,
      segmentStart: 12,
      segmentEnd: 48,
    })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
  })
})
