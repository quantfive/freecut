// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import {
  closeAllGapsOnTrack,
  closeGapAtPosition,
  moveItem,
  moveItems,
  removeItems,
  rippleDeleteItems,
  unlinkItems,
  updateItem,
} from './item-actions'

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order' | 'kind'>,
): TimelineTrack {
  return {
    height: 80,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 10,
    sourceEnd: 70,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    sourceStart: 10,
    sourceEnd: 70,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

function expectNoHistory(): void {
  expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
}

describe('track lock mutation invariants', () => {
  beforeEach(() => {
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  })

  it('rejects direct timing, track, source-placement, and delete mutations on a locked item', () => {
    const lockedTrack = makeTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
      locked: true,
    })
    const otherTrack = makeTrack({
      id: 'video-track-2',
      name: 'V2',
      kind: 'video',
      order: 1,
    })
    const original = makeVideoItem()
    useItemsStore.getState().setTracks([lockedTrack, otherTrack])
    useItemsStore.getState().setItems([original])

    updateItem(original.id, {
      from: 20,
      durationInFrames: 30,
      trackId: otherTrack.id,
      sourceStart: 40,
      sourceEnd: 70,
    })
    moveItem(original.id, 30, otherTrack.id)
    removeItems([original.id])

    expect(useItemsStore.getState().itemById[original.id]).toEqual(original)
    expectNoHistory()
  })

  it('rejects plain and ripple delete atomically when a linked companion is locked', () => {
    const videoTrack = makeTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
    })
    const audioTrack = makeTrack({
      id: 'audio-track',
      name: 'A1',
      kind: 'audio',
      order: 1,
      locked: true,
    })
    const video = makeVideoItem({ linkedGroupId: 'linked-av' })
    const audio = makeAudioItem({ linkedGroupId: 'linked-av' })
    useItemsStore.getState().setTracks([videoTrack, audioTrack])
    useItemsStore.getState().setItems([video, audio])

    removeItems([video.id])
    rippleDeleteItems([video.id])

    expect(useItemsStore.getState().items).toEqual([video, audio])
    expectNoHistory()
  })

  it('requires explicit unlink before deleting away from a locked companion', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({
        id: 'audio-track',
        name: 'A1',
        kind: 'audio',
        order: 1,
        locked: true,
      }),
    ])
    const video = makeVideoItem({ linkedGroupId: 'linked-av' })
    const audio = makeAudioItem({ linkedGroupId: 'linked-av' })
    useItemsStore.getState().setItems([video, audio])

    removeItems([video.id])
    expect(useItemsStore.getState().items).toHaveLength(2)
    expectNoHistory()

    unlinkItems([video.id])
    removeItems([video.id])

    expect(useItemsStore.getState().itemById[video.id]).toBeUndefined()
    expect(useItemsStore.getState().itemById[audio.id]).toBeDefined()
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
  })

  it('allows ripple delete on unlocked tracks while a locked sync-lock track stays byte-for-byte fixed', () => {
    const videoTrack = makeTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
    })
    const lockedAudioTrack = makeTrack({
      id: 'audio-track',
      name: 'A1',
      kind: 'audio',
      order: 1,
      locked: true,
      syncLock: true,
    })
    const deleted = makeVideoItem({ id: 'delete', durationInFrames: 30 })
    const downstream = makeVideoItem({
      id: 'downstream',
      from: 50,
      durationInFrames: 20,
      mediaId: 'media-2',
    })
    const lockedBed = makeAudioItem({
      id: 'locked-bed',
      from: 0,
      durationInFrames: 100,
      sourceStart: 20,
      sourceEnd: 120,
      sourceDuration: 180,
    })
    useItemsStore.getState().setTracks([videoTrack, lockedAudioTrack])
    useItemsStore.getState().setItems([deleted, downstream, lockedBed])

    rippleDeleteItems([deleted.id])

    expect(useItemsStore.getState().itemById[deleted.id]).toBeUndefined()
    expect(useItemsStore.getState().itemById[downstream.id]).toMatchObject({ from: 20 })
    expect(useItemsStore.getState().itemById[lockedBed.id]).toEqual(lockedBed)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('rejects close-gap commands on a locked track without history', () => {
    const lockedTrack = makeTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
      locked: true,
    })
    const first = makeVideoItem({ id: 'first', durationInFrames: 30 })
    const second = makeVideoItem({ id: 'second', from: 60, durationInFrames: 30 })
    useItemsStore.getState().setTracks([lockedTrack])
    useItemsStore.getState().setItems([first, second])

    closeGapAtPosition(lockedTrack.id, 45)
    closeAllGapsOnTrack(lockedTrack.id)

    expect(useItemsStore.getState().items).toEqual([first, second])
    expectNoHistory()
  })

  it('rejects close-gap and bulk-move plans that would peel away from a locked linked companion', () => {
    const videoTrack = makeTrack({
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      order: 0,
    })
    const audioTrack = makeTrack({
      id: 'audio-track',
      name: 'A1',
      kind: 'audio',
      order: 1,
      locked: true,
    })
    const anchor = makeVideoItem({ id: 'anchor', durationInFrames: 30 })
    const video = makeVideoItem({ id: 'linked-video', from: 60, linkedGroupId: 'linked-av' })
    const audio = makeAudioItem({ id: 'linked-audio', from: 60, linkedGroupId: 'linked-av' })
    useItemsStore.getState().setTracks([videoTrack, audioTrack])
    useItemsStore.getState().setItems([anchor, video, audio])

    closeGapAtPosition(videoTrack.id, 45)
    closeAllGapsOnTrack(videoTrack.id)
    moveItems([
      { id: video.id, from: 10 },
      { id: audio.id, from: 10 },
    ])

    expect(useItemsStore.getState().itemById[video.id]).toEqual(video)
    expect(useItemsStore.getState().itemById[audio.id]).toEqual(audio)
    expectNoHistory()
  })
})
