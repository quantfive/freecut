import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, renderHook } from '@testing-library/react'
import type { TextItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import {
  makeTimelineAudioItem,
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineDrag } from './use-timeline-drag'

const TIMELINE_DURATION = 600
const TRACK_HEIGHT = 80
let rafCallbacks = new Map<number, FrameRequestCallback>()
let nextRafId = 1

function makeRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 1000,
    bottom,
    width: 1000,
    height: bottom - top,
    toJSON: () => ({}),
  }
}

function mountTimelineTracks(tracks: TimelineTrack[]): Map<string, number> {
  const container = document.createElement('div')
  container.className = 'timeline-container'
  const trackContainer = document.createElement('div')
  trackContainer.className = 'timeline-tracks'
  container.appendChild(trackContainer)
  document.body.appendChild(container)

  const orderedTracks = [...tracks].sort((left, right) => left.order - right.order)
  const centerYByTrackId = new Map<string, number>()
  orderedTracks.forEach((track, index) => {
    const top = index * TRACK_HEIGHT
    const row = document.createElement('div')
    row.dataset.trackId = track.id
    row.getBoundingClientRect = () => makeRect(top, top + TRACK_HEIGHT)
    trackContainer.appendChild(row)
    centerYByTrackId.set(track.id, top + TRACK_HEIGHT / 2)
  })

  trackContainer.getBoundingClientRect = () =>
    makeRect(-TRACK_HEIGHT, orderedTracks.length * TRACK_HEIGHT + TRACK_HEIGHT)
  container.getBoundingClientRect = trackContainer.getBoundingClientRect
  return centerYByTrackId
}

function setupStores(tracks: TimelineTrack[], items: TimelineItem[]) {
  resetTimelineCompositionTestState()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false, snapEnabled: false })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useItemsStore.getState().setTracks(tracks)
  useItemsStore.getState().setItems(items)
  useTransitionsStore.getState().setTransitions([])
  useEditorStore.setState({ linkedSelectionEnabled: true })
  useSelectionStore.getState().clearSelection()
  useSelectionStore.getState().setDragState(null)
  useSelectionStore.getState().setActiveSnapTarget(null)
  useSelectionStore.getState().setActiveLinkedDropTarget(null)
  useLinkedEditPreviewStore.getState().clear()
}

function flushAnimationFrames() {
  const callbacks = Array.from(rafCallbacks.values())
  rafCallbacks.clear()
  for (const callback of callbacks) {
    callback(performance.now())
  }
}

function beginDrag(
  result: { current: ReturnType<typeof useTimelineDrag> },
  startX: number,
  startY: number,
) {
  const target = document.createElement('div')
  const event = {
    target,
    clientX: startX,
    clientY: startY,
    ctrlKey: false,
    metaKey: false,
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent

  act(() => {
    result.current.handleDragStart(event)
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 4, clientY: startY }))
  })
}

function moveDrag(clientX: number, clientY: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
    flushAnimationFrames()
  })
}

function releaseDrag() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

function getItem(id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  expect(item).toBeDefined()
  return item as TimelineItem
}

function makeThreeSectionTracks(): TimelineTrack[] {
  return [
    makeTimelineTrack({ id: 'v3', name: 'V3', kind: 'video', order: 0 }),
    makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
    makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 2 }),
    makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 3 }),
    makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 4 }),
    makeTimelineTrack({ id: 'a3', name: 'A3', kind: 'audio', order: 5 }),
  ]
}

describe('useTimelineDrag linked cohorts', () => {
  beforeEach(() => {
    rafCallbacks = new Map()
    nextRafId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextRafId
      nextRafId += 1
      rafCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id)
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('moves two linked pairs together and applies one collision correction to the cohort', () => {
    const tracks = makeThreeSectionTracks()
    const video1 = makeTimelineVideoItem({
      id: 'video-1',
      trackId: 'v1',
      from: 0,
      durationInFrames: 10,
      linkedGroupId: 'pair-1',
    })
    const audio1 = makeTimelineAudioItem({
      id: 'audio-1',
      trackId: 'a1',
      from: 0,
      durationInFrames: 10,
      linkedGroupId: 'pair-1',
    })
    const video2 = makeTimelineVideoItem({
      id: 'video-2',
      trackId: 'v2',
      from: 40,
      durationInFrames: 10,
      linkedGroupId: 'pair-2',
      mediaId: 'media-2',
    })
    const audio2 = makeTimelineAudioItem({
      id: 'audio-2',
      trackId: 'a2',
      from: 40,
      durationInFrames: 10,
      linkedGroupId: 'pair-2',
      mediaId: 'media-2',
    })
    const blocker = makeTimelineVideoItem({
      id: 'blocker',
      trackId: 'v2',
      from: 20,
      durationInFrames: 10,
      mediaId: 'blocker-media',
    })
    setupStores(tracks, [video1, audio1, video2, audio2, blocker])
    useSelectionStore.getState().selectItems(['video-1', 'video-2'])
    const yByTrackId = mountTimelineTracks(tracks)
    const { result } = renderHook(() => useTimelineDrag(video1, TIMELINE_DURATION))

    beginDrag(result, 0, yByTrackId.get('v1')!)
    moveDrag(20, yByTrackId.get('v2')!)
    releaseDrag()

    expect(getItem('video-1')).toMatchObject({ trackId: 'v2', from: 10 })
    expect(getItem('audio-1')).toMatchObject({ trackId: 'a2', from: 10 })
    expect(getItem('video-2')).toMatchObject({ trackId: 'v3', from: 50 })
    expect(getItem('audio-2')).toMatchObject({ trackId: 'a3', from: 50 })
    expect(getItem('video-2').from - getItem('video-1').from).toBe(40)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('moves an attached caption on its visual section without losing its frame offset', () => {
    const tracks = makeThreeSectionTracks()
    const video = makeTimelineVideoItem({
      id: 'video-1',
      trackId: 'v1',
      linkedGroupId: 'pair-1',
    })
    const audio = makeTimelineAudioItem({
      id: 'audio-1',
      trackId: 'a1',
      linkedGroupId: 'pair-1',
    })
    const caption: TextItem = {
      id: 'caption-1',
      type: 'text',
      trackId: 'v2',
      from: 5,
      durationInFrames: 20,
      label: 'Caption',
      text: 'Caption',
      textRole: 'caption',
      captionSource: { type: 'transcript', clipId: 'video-1', mediaId: 'media-1' },
      color: '#ffffff',
    }
    setupStores(tracks, [video, audio, caption])
    useSelectionStore.getState().selectItems(['video-1'])
    const yByTrackId = mountTimelineTracks(tracks)
    const { result } = renderHook(() => useTimelineDrag(video, TIMELINE_DURATION))

    beginDrag(result, 0, yByTrackId.get('v1')!)
    moveDrag(10, yByTrackId.get('v2')!)
    releaseDrag()

    expect(getItem('video-1')).toMatchObject({ trackId: 'v2', from: 10 })
    expect(getItem('audio-1')).toMatchObject({ trackId: 'a2', from: 10 })
    expect(getItem('caption-1')).toMatchObject({ trackId: 'v3', from: 15 })
  })

  it('creates corresponding outer lanes and undoes the whole cohort atomically', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ]
    const video1 = makeTimelineVideoItem({
      id: 'video-1',
      trackId: 'v1',
      linkedGroupId: 'pair-1',
    })
    const audio1 = makeTimelineAudioItem({
      id: 'audio-1',
      trackId: 'a1',
      linkedGroupId: 'pair-1',
    })
    const video2 = makeTimelineVideoItem({
      id: 'video-2',
      trackId: 'v2',
      from: 80,
      linkedGroupId: 'pair-2',
      mediaId: 'media-2',
    })
    const audio2 = makeTimelineAudioItem({
      id: 'audio-2',
      trackId: 'a2',
      from: 80,
      linkedGroupId: 'pair-2',
      mediaId: 'media-2',
    })
    setupStores(tracks, [video1, audio1, video2, audio2])
    useSelectionStore.getState().selectItems(['video-1', 'video-2'])
    const yByTrackId = mountTimelineTracks(tracks)
    const { result } = renderHook(() => useTimelineDrag(video1, TIMELINE_DURATION))

    beginDrag(result, 0, yByTrackId.get('v1')!)
    moveDrag(10, -TRACK_HEIGHT / 2)
    releaseDrag()

    const movedVideo2Track = useItemsStore
      .getState()
      .tracks.find((track) => track.id === getItem('video-2').trackId)
    const movedAudio2Track = useItemsStore
      .getState()
      .tracks.find((track) => track.id === getItem('audio-2').trackId)
    expect(getItem('video-1')).toMatchObject({ trackId: 'v2', from: 10 })
    expect(getItem('audio-1')).toMatchObject({ trackId: 'a2', from: 10 })
    expect(movedVideo2Track).toMatchObject({ kind: 'video', name: 'V3' })
    expect(movedAudio2Track).toMatchObject({ kind: 'audio', name: 'A3' })
    expect(useItemsStore.getState().tracks).toHaveLength(6)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    act(() => {
      useTimelineCommandStore.getState().undo()
    })

    expect(useItemsStore.getState().tracks).toHaveLength(4)
    expect(getItem('video-1')).toMatchObject({ trackId: 'v1', from: 0 })
    expect(getItem('audio-1')).toMatchObject({ trackId: 'a1', from: 0 })
    expect(getItem('video-2')).toMatchObject({ trackId: 'v2', from: 80 })
    expect(getItem('audio-2')).toMatchObject({ trackId: 'a2', from: 80 })
  })

  it('rejects the whole cohort when an implicitly linked companion is locked', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2, locked: true }),
      makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ]
    const video = makeTimelineVideoItem({
      id: 'video-1',
      trackId: 'v1',
      linkedGroupId: 'pair-1',
    })
    const audio = makeTimelineAudioItem({
      id: 'audio-1',
      trackId: 'a1',
      linkedGroupId: 'pair-1',
    })
    setupStores(tracks, [video, audio])
    const yByTrackId = mountTimelineTracks(tracks)
    const { result } = renderHook(() => useTimelineDrag(video, TIMELINE_DURATION))

    beginDrag(result, 0, yByTrackId.get('v1')!)
    moveDrag(20, yByTrackId.get('v2')!)
    releaseDrag()

    expect(result.current.isDragging).toBe(false)
    expect(useSelectionStore.getState().dragState).toBeNull()
    expect(getItem('video-1')).toMatchObject({ trackId: 'v1', from: 0 })
    expect(getItem('audio-1')).toMatchObject({ trackId: 'a1', from: 0 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('keeps unlinked multi-select lock filtering behavior unchanged', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0, locked: true }),
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
    ]
    const unlocked = makeTimelineVideoItem({ id: 'unlocked', trackId: 'v1', durationInFrames: 10 })
    const locked = makeTimelineVideoItem({
      id: 'locked',
      trackId: 'v2',
      from: 40,
      durationInFrames: 10,
      mediaId: 'media-2',
    })
    setupStores(tracks, [unlocked, locked])
    useSelectionStore.getState().selectItems(['unlocked', 'locked'])
    const yByTrackId = mountTimelineTracks(tracks)
    const { result } = renderHook(() => useTimelineDrag(unlocked, TIMELINE_DURATION))

    beginDrag(result, 0, yByTrackId.get('v1')!)
    moveDrag(10, yByTrackId.get('v1')!)
    releaseDrag()

    expect(getItem('unlocked')).toMatchObject({ trackId: 'v1', from: 10 })
    expect(getItem('locked')).toMatchObject({ trackId: 'v2', from: 40 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })
})
