import { act, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem as TimelineItemType, TimelineTrack } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { useZoomStore } from '../../stores/zoom-store'
import { TimelineItem } from './index'
import { isTimelinePointerControl } from '../../utils/timeline-pointer'
import { clearTimelineHover, setTimelineHover } from '../../utils/timeline-hover-state'
import { useToolShortcuts } from '../../hooks/shortcuts/use-tool-shortcuts'

vi.mock('./clip-content', () => ({
  ClipContent: ({ item }: { item: TimelineItemType }) => (
    <div data-testid={`clip-content-${item.id}`}>{item.label}</div>
  ),
}))

const FPS = 30
const CLIP_FRAMES = 60
let rafCallbacks: FrameRequestCallback[] = []

function makeTracks(audioParentId?: string): TimelineTrack[] {
  const tracks: TimelineTrack[] = [
    makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
    makeTimelineTrack({
      id: 'track-a1',
      name: 'A1',
      kind: 'audio',
      order: audioParentId ? 2 : 1,
      parentTrackId: audioParentId,
    }),
  ]
  if (audioParentId) {
    tracks.splice(
      1,
      0,
      makeTimelineTrack({
        id: audioParentId,
        name: 'Locked audio group',
        order: 1,
        isGroup: true,
        locked: true,
      }),
    )
  }
  return tracks
}

function makeVideoPair() {
  return [
    makeTimelineVideoItem({
      id: 'video-left',
      label: 'red.mp4',
      linkedGroupId: 'left-cohort',
    }),
    makeTimelineVideoItem({
      id: 'video-right',
      label: 'blue.mp4',
      mediaId: 'media-2',
      from: CLIP_FRAMES,
      linkedGroupId: 'right-cohort',
    }),
  ] as const
}

function makeLinkedFixtureItems() {
  const [videoLeft, videoRight] = makeVideoPair()
  return [
    videoLeft,
    videoRight,
    makeTimelineAudioItem({
      id: 'audio-left',
      label: 'red.wav',
      linkedGroupId: 'left-cohort',
    }),
    makeTimelineAudioItem({
      id: 'audio-right',
      label: 'blue.wav',
      mediaId: 'media-2',
      from: CLIP_FRAMES,
      linkedGroupId: 'right-cohort',
    }),
  ]
}

function resetStores(tracks: TimelineTrack[], items: TimelineItemType[]): void {
  useEditorStore.setState({ hostMode: false, linkedSelectionEnabled: true })
  useItemsStore.getState().setTracks(tracks)
  useItemsStore.getState().setItems(items)
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: FPS, isDirty: false, snapEnabled: false })
  useZoomStore.setState({
    level: 0.3,
    pixelsPerSecond: FPS,
    contentLevel: 0.3,
    contentPixelsPerSecond: FPS,
    isZoomInteracting: false,
  })
  useSelectionStore.getState().clearSelection()
  useSelectionStore.getState().setActiveTool('select')
  useSelectionStore.getState().setDragState(null)
  useSelectionStore.getState().setActiveSnapTarget(null)
  usePlaybackStore.setState({ currentFrame: 0, previewFrame: null, isPlaying: false })
}

function renderItems(
  items: readonly TimelineItemType[],
  lockedTrackIds = new Set<string>(),
  isCompactWidth = false,
) {
  const view = render(
    <div className="timeline-tracks">
      {items.map((item) => (
        <TimelineItem
          key={item.id}
          item={item}
          timelineDuration={600}
          trackLocked={lockedTrackIds.has(item.trackId)}
          trackHidden={false}
          isCompactWidth={isCompactWidth}
          isDetailEligible
        />
      ))}
    </div>,
  )

  for (const item of items) {
    const root = view.container.querySelector<HTMLElement>(`[data-item-id="${item.id}"]`)
    expect(root).toBeTruthy()
    const left = item.from
    const width = item.durationInFrames
    vi.spyOn(root!, 'getBoundingClientRect').mockReturnValue({
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 80,
      width,
      height: 80,
      toJSON: () => ({}),
    })
  }

  return view
}

function flushAnimationFrame(): void {
  act(() => {
    const callbacks = rafCallbacks
    rafCallbacks = []
    for (const callback of callbacks) callback(performance.now())
  })
}

function dragOneFrame(handle: HTMLElement): void {
  fireEvent.mouseDown(handle, { button: 0, clientX: CLIP_FRAMES })
  fireEvent.mouseMove(window, { clientX: CLIP_FRAMES + 1 })
  flushAnimationFrame()
  fireEvent.mouseUp(window, { clientX: CLIP_FRAMES + 1 })
}

function itemSnapshot() {
  return structuredClone(useItemsStore.getState().items)
}

function MountedShortcutHarness() {
  useToolShortcuts({})
  return null
}

describe('TimelineItem contiguous rolling trim affordance', () => {
  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts one visible, hit-testable shared-edge handle when either neighbor is selected or the cut is hovered', () => {
    const items = makeVideoPair()
    resetStores(makeTracks(), [...items])
    const view = renderItems(items, new Set(), true)

    act(() => useSelectionStore.getState().selectItems(['video-left']))
    const leftRoot = view.container.querySelector<HTMLElement>('[data-item-id="video-left"]')!
    expect(leftRoot).toHaveAttribute('data-compact-clip', 'true')
    const leftOwnedHandle = within(leftRoot).getByRole('slider', { name: /rolling trim/i })
    expect(leftOwnedHandle).toHaveAttribute('data-rolling-trim-handle', 'end')
    expect(leftOwnedHandle).not.toHaveClass('pointer-events-none')

    act(() => useSelectionStore.getState().selectItems(['video-right']))
    expect(within(leftRoot).queryByRole('slider', { name: /rolling trim/i })).toBeNull()
    const rightRoot = view.container.querySelector<HTMLElement>('[data-item-id="video-right"]')!
    const rightOwnedHandle = within(rightRoot).getByRole('slider', { name: /rolling trim/i })
    expect(rightOwnedHandle).toHaveAttribute('data-rolling-trim-handle', 'start')

    act(() => useSelectionStore.getState().clearSelection())
    fireEvent.mouseMove(leftRoot, { clientX: CLIP_FRAMES, clientY: 40 })
    expect(within(leftRoot).getByRole('slider', { name: /rolling trim/i })).toBeVisible()

    act(() => useSelectionStore.getState().setActiveTool('razor'))
    expect(view.container.querySelector('[data-rolling-trim-handle]')).toBeNull()
  })

  it('splits the mounted clip when a real Razor click targets its hit surface', () => {
    const clip = makeTimelineVideoItem({ id: 'razor-target', from: 0, durationInFrames: 60 })
    resetStores(makeTracks(), [clip])
    const view = renderItems([clip])
    const shortcutView = render(<MountedShortcutHarness />)
    const root = view.container.querySelector<HTMLElement>('[data-item-id="razor-target"]')!
    const splitItem = vi.spyOn(useTimelineStore.getState(), 'splitItem')
    const hit = root.querySelector<HTMLElement>('[data-timeline-item]')!
    expect(hit).toBeTruthy()
    expect(isTimelinePointerControl(hit)).toBe(false)

    fireEvent.keyDown(document, { key: 'C', code: 'KeyC', shiftKey: true })
    expect(useSelectionStore.getState().activeTool).toBe('razor')
    fireEvent.click(hit, { button: 0, clientX: 30, clientY: 40 })

    expect(splitItem).toHaveBeenCalled()
    expect(useItemsStore.getState().items).toHaveLength(2)
    expect(useItemsStore.getState().items.map((item) => item.durationInFrames)).toEqual([30, 30])

    shortcutView.unmount()
    view.unmount()
  })

  it('splits the mounted hovered clip from the unmodified C shortcut without moving playback', () => {
    const clip = makeTimelineVideoItem({ id: 'hover-target', from: 0, durationInFrames: 60 })
    resetStores(makeTracks(), [clip])
    const view = renderItems([clip])
    const shortcutView = render(<MountedShortcutHarness />)

    setTimelineHover('hover-target', 24)
    fireEvent.keyDown(document, { key: 'c', code: 'KeyC' })

    expect(useItemsStore.getState().items).toHaveLength(2)
    expect(useItemsStore.getState().items.map((item) => item.durationInFrames)).toEqual([24, 36])
    expect(usePlaybackStore.getState().currentFrame).toBe(0)

    clearTimelineHover()
    shortcutView.unmount()
    view.unmount()
  })

  it('drags a linked A/V cut by one frame as one command and undo restores all four clips', () => {
    const items = makeLinkedFixtureItems()
    resetStores(makeTracks(), items)
    useSelectionStore.getState().selectItems(['video-right', 'audio-right'])
    const view = renderItems(items)
    const videoRight = view.container.querySelector<HTMLElement>('[data-item-id="video-right"]')!
    const handle = within(videoRight).getByRole('slider', { name: /rolling trim/i })
    const undoDepthBefore = useTimelineCommandStore.getState().undoStack.length

    dragOneFrame(handle)

    expect(useItemsStore.getState().itemById).toMatchObject({
      'video-left': { durationInFrames: 61, sourceEnd: 61 },
      'video-right': { from: 61, durationInFrames: 59, sourceStart: 1 },
      'audio-left': { durationInFrames: 61, sourceEnd: 61 },
      'audio-right': { from: 61, durationInFrames: 59, sourceStart: 1 },
    })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepthBefore + 1)

    act(() => useTimelineCommandStore.getState().undo())

    expect(useItemsStore.getState().itemById).toMatchObject({
      'video-left': { durationInFrames: 60, sourceEnd: 60 },
      'video-right': { from: 60, durationInFrames: 60, sourceStart: 0 },
      'audio-left': { durationInFrames: 60, sourceEnd: 60 },
      'audio-right': { from: 60, durationInFrames: 60, sourceStart: 0 },
    })
  })

  it('exposes slider semantics without nesting a button and supports one-frame arrow nudges', () => {
    const items = makeVideoPair()
    resetStores(makeTracks(), [...items])
    useSelectionStore.getState().selectItems(['video-right'])
    const view = renderItems(items)
    const videoRight = view.container.querySelector<HTMLElement>('[data-item-id="video-right"]')!
    const handle = within(videoRight).getByRole('slider', { name: /rolling trim/i })

    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).toHaveAttribute('aria-valuenow', '60')
    expect(handle.closest('button')).toBeNull()

    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect(useItemsStore.getState().itemById).toMatchObject({
      'video-left': { durationInFrames: 61 },
      'video-right': { from: 61, durationInFrames: 59 },
    })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('rejects the whole gesture when a linked participant is effectively locked', () => {
    const items = makeLinkedFixtureItems()
    resetStores(makeTracks('locked-group'), items)
    useSelectionStore.getState().selectItems(['video-right', 'audio-right'])
    const view = renderItems(items)
    const videoRight = view.container.querySelector<HTMLElement>('[data-item-id="video-right"]')!
    const handle = within(videoRight).getByRole('slider', { name: /rolling trim/i })
    const before = {
      items: itemSnapshot(),
      selection: [...useSelectionStore.getState().selectedItemIds],
      undoDepth: useTimelineCommandStore.getState().undoStack.length,
      redoDepth: useTimelineCommandStore.getState().redoStack.length,
      dirty: useTimelineSettingsStore.getState().isDirty,
    }

    dragOneFrame(handle)

    expect(useItemsStore.getState().items).toEqual(before.items)
    expect(useSelectionStore.getState().selectedItemIds).toEqual(before.selection)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(before.undoDepth)
    expect(useTimelineCommandStore.getState().redoStack).toHaveLength(before.redoDepth)
    expect(useTimelineSettingsStore.getState().isDirty).toBe(before.dirty)
  })

  it('keeps the ordinary isolated edge trim handle hit-testable and commits only that edge', () => {
    const clip = makeTimelineVideoItem({ id: 'isolated' })
    resetStores(makeTracks(), [clip])
    useSelectionStore.getState().selectItems(['isolated'])
    const view = renderItems([clip])
    const root = view.container.querySelector<HTMLElement>('[data-item-id="isolated"]')!

    expect(within(root).queryByRole('slider', { name: /rolling trim/i })).toBeNull()
    fireEvent.mouseMove(root, { clientX: CLIP_FRAMES, clientY: 40 })
    const ordinaryHandle = root.querySelector<HTMLElement>('[data-trim-handle="end"]')!
    expect(ordinaryHandle).toBeTruthy()
    expect(ordinaryHandle).not.toHaveClass('pointer-events-none')

    dragOneFrame(ordinaryHandle)

    expect(useItemsStore.getState().itemById.isolated).toMatchObject({
      from: 0,
      durationInFrames: 61,
      sourceStart: 0,
      sourceEnd: 61,
    })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })
})
