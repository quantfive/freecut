import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem as TimelineItemType, TimelineTrack, VideoItem } from '@/types/timeline'

import { usePlaybackShortcuts } from '../../hooks/shortcuts/use-playback-shortcuts'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { TimelineItemHitTarget } from '../timeline-item-hit-target'
import { TimelineItem } from '.'

const dragMocks = vi.hoisted(() => ({
  handleDragStart: vi.fn(),
}))

vi.mock('../../hooks/use-timeline-drag', () => ({
  dragOffsetRef: { current: { x: 0, y: 0 } },
  dragPreviewOffsetByItemRef: { current: {} },
  useTimelineDrag: () => ({
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    handleDragStart: dragMocks.handleDragStart,
  }),
}))

vi.mock('./item-context-menu', () => ({
  ItemContextMenu: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./clip-content', () => ({ ClipContent: () => <span>Clip picture</span> }))
vi.mock('./clip-indicators', () => ({
  ClipIndicators: ({ onKeyframesToggle }: { onKeyframesToggle?: () => void }) => (
    <button type="button" aria-label="Show keyframe panel" onClick={onKeyframesToggle}>
      Keyframes
    </button>
  ),
}))
vi.mock('./trim-handles', () => ({ TrimHandles: () => null }))
vi.mock('./stretch-handles', () => ({ StretchHandles: () => null }))
vi.mock('./audio-fade-handles', () => ({ AudioFadeHandles: () => null }))
vi.mock('./video-fade-handles', () => ({ VideoFadeHandles: () => null }))
vi.mock('./audio-volume-control', () => ({ AudioVolumeControl: () => null }))
vi.mock('./join-indicators', () => ({ ZoomGatedJoinIndicators: () => null }))
vi.mock('./segment-status-overlays', () => ({ SegmentStatusOverlays: () => null }))
vi.mock('./clip-floating-layer', () => ({ ClipFloatingLayer: () => null }))

const VIDEO_TRACK: TimelineTrack = {
  id: 'track-video-1',
  name: 'V1',
  kind: 'video',
  height: 72,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const AUDIO_TRACK: TimelineTrack = {
  ...VIDEO_TRACK,
  id: 'track-audio-1',
  name: 'A1',
  kind: 'audio',
  locked: true,
  order: 1,
}

const ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: VIDEO_TRACK.id,
  from: 30,
  durationInFrames: 60,
  label: 'Interview close-up.mp4',
  src: 'blob:clip-video-1',
  mediaId: 'media-video-1',
  sourceStart: 0,
  sourceEnd: 60,
}

function setTimeline(items: TimelineItemType[], tracks: TimelineTrack[]) {
  useItemsStore.getState().setItems(items)
  useItemsStore.getState().setTracks(tracks)
  useTimelineStore.setState({ fps: 30, items, tracks })
}

function renderItem(item: TimelineItemType = ITEM, trackLocked = false) {
  return render(
    <>
      <TimelineItem
        item={item}
        timelineDuration={10}
        trackLocked={trackLocked}
        isCompactWidth={false}
        isDetailEligible
      />
      <TimelineItemHitTarget item={item} trackLocked={trackLocked} onHoverChange={vi.fn()} />
    </>,
  )
}

function PlaybackShortcutHarness({ children }: { children: React.ReactNode }) {
  usePlaybackShortcuts({})
  return children
}

function dispatchKey(target: HTMLElement, key: string, code: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
  })
  act(() => target.dispatchEvent(event))
  return event
}

describe('TimelineItem keyboard accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().setLinkedSelectionEnabled(false)
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setActiveTool('select')
    usePlaybackStore.setState({ isPlaying: false, currentFrame: 0 })
    setTimeline([ITEM], [{ ...VIDEO_TRACK, items: [ITEM] }])
  })

  it('exposes one named clip focus target with media, type, time range, and selected state', () => {
    const { container } = renderItem()
    const semanticRoots = container.querySelectorAll<HTMLElement>(
      '[data-timeline-item][role="button"][tabindex="0"]',
    )
    expect(semanticRoots).toHaveLength(1)

    const clip = semanticRoots[0]!
    expect(clip).toHaveAccessibleName(/Interview close-up\.mp4/i)
    expect(clip).toHaveAccessibleName(/video/i)
    expect(clip).toHaveAccessibleName(/00:00:01:00/i)
    expect(clip).toHaveAccessibleName(/00:00:02:29/i)
    expect(clip).toHaveAttribute('aria-pressed', 'false')

    act(() => useSelectionStore.getState().selectItems([ITEM.id]))
    expect(clip).toHaveAttribute('aria-pressed', 'true')

    clip.focus()
    expect(clip).toHaveFocus()
    expect(container.querySelector('[data-timeline-hit-target]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(container.querySelector('[data-timeline-hit-target]')).not.toHaveAttribute('tabindex')
  })

  it.each([
    ['Enter', 'Enter'],
    [' ', 'Space'],
  ])('activates exactly once with %s after global capture declines it', (key, code) => {
    const selectItems = vi.spyOn(useSelectionStore.getState(), 'selectItems')
    const togglePlayPause = vi.spyOn(usePlaybackStore.getState(), 'togglePlayPause')
    const captureListener = vi.fn()
    document.addEventListener('keydown', captureListener, { capture: true })

    const { container } = render(
      <PlaybackShortcutHarness>
        <TimelineItem
          item={ITEM}
          timelineDuration={10}
          trackLocked={false}
          isCompactWidth={false}
          isDetailEligible
        />
      </PlaybackShortcutHarness>,
    )
    const clip = container.querySelector<HTMLElement>('[data-timeline-item]')!
    const event = dispatchKey(clip, key, code)

    document.removeEventListener('keydown', captureListener, { capture: true })
    expect(captureListener).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(selectItems).toHaveBeenCalledTimes(1)
    expect(selectItems).toHaveBeenLastCalledWith([ITEM.id])
    expect(togglePlayPause).not.toHaveBeenCalled()
  })

  it('keeps native clip controls outside button semantics and lets them own keyboard events', () => {
    const selectItems = vi.spyOn(useSelectionStore.getState(), 'selectItems')
    const { container, getByRole } = renderItem()
    const clip = container.querySelector<HTMLElement>('[data-timeline-item]')!
    const control = getByRole('button', { name: 'Show keyframe panel' })
    const controlKeyDown = vi.fn()
    control.addEventListener('keydown', controlKeyDown)

    expect(clip.contains(control)).toBe(false)
    control.focus()
    expect(control).toHaveFocus()
    dispatchKey(control, ' ', 'Space')

    expect(controlKeyDown).toHaveBeenCalledTimes(1)
    expect(selectItems).not.toHaveBeenCalled()
  })

  it('semantically declines J, K, and L transport while the clip root is focused', () => {
    const { container } = render(
      <PlaybackShortcutHarness>
        <TimelineItem
          item={ITEM}
          timelineDuration={10}
          trackLocked={false}
          isCompactWidth={false}
          isDetailEligible
        />
      </PlaybackShortcutHarness>,
    )
    const clip = container.querySelector<HTMLElement>('[data-timeline-item]')!
    clip.focus()

    dispatchKey(clip, 'j', 'KeyJ')
    dispatchKey(clip, 'k', 'KeyK')
    dispatchKey(clip, 'l', 'KeyL')

    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
    })
  })

  it('keeps direct and linked-cohort locked clips focusable but mutation-inert', () => {
    const linkedItem = { ...ITEM, linkedGroupId: 'av-1' }
    const linkedAudio = {
      ...ITEM,
      id: 'clip-audio-1',
      type: 'audio' as const,
      trackId: AUDIO_TRACK.id,
      linkedGroupId: 'av-1',
    }
    setTimeline(
      [linkedItem, linkedAudio],
      [
        { ...VIDEO_TRACK, items: [linkedItem] },
        { ...AUDIO_TRACK, items: [linkedAudio] },
      ],
    )
    const selectItems = vi.spyOn(useSelectionStore.getState(), 'selectItems')
    const togglePlayPause = vi.spyOn(usePlaybackStore.getState(), 'togglePlayPause')
    const { container, rerender } = renderItem(linkedItem)
    const linkedLockedClip = container.querySelector<HTMLElement>('[data-timeline-item]')!

    expect(linkedLockedClip).toHaveAttribute('aria-disabled', 'true')
    linkedLockedClip.focus()
    expect(linkedLockedClip).toHaveFocus()
    dispatchKey(linkedLockedClip, ' ', 'Space')
    dispatchKey(linkedLockedClip, 'Enter', 'Enter')
    expect(selectItems).not.toHaveBeenCalled()
    expect(togglePlayPause).not.toHaveBeenCalled()

    rerender(
      <TimelineItem
        item={ITEM}
        timelineDuration={10}
        trackLocked
        isCompactWidth={false}
        isDetailEligible
      />,
    )
    const directlyLockedClip = container.querySelector<HTMLElement>('[data-timeline-item]')!
    expect(directlyLockedClip).toHaveAttribute('aria-disabled', 'true')
    dispatchKey(directlyLockedClip, ' ', 'Space')
    expect(selectItems).not.toHaveBeenCalled()
    expect(togglePlayPause).not.toHaveBeenCalled()
  })

  it('preserves click, drag, and Razor ownership on the semantic surface', () => {
    const splitItem = vi.spyOn(useTimelineStore.getState(), 'splitItem')
    const { container } = renderItem()
    const clip = container.querySelector<HTMLElement>('[data-timeline-item]')!

    fireEvent.mouseDown(clip, { button: 0, clientX: 20, clientY: 10 })
    expect(dragMocks.handleDragStart).toHaveBeenCalledTimes(1)

    act(() => useSelectionStore.getState().setActiveTool('razor'))
    fireEvent.click(clip, { button: 0, clientX: 20, clientY: 10 })
    expect(splitItem).toHaveBeenCalledTimes(1)
  })
})
