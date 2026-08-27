import { useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
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
import { useTimelineStore } from '../stores/timeline-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useZoomStore } from '../stores/zoom-store'
import { getLinkedItemIds } from '../utils/linked-items'
import { resetPostTimelineGestureClickForTest } from '../components/timeline-item/post-drag-click-guard'
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

function captureSelectionMetadata() {
  const state = useSelectionStore.getState()
  return {
    selectedItemIds: [...state.selectedItemIds],
    selectedItemIdSet: new Set(state.selectedItemIdSet),
    selectedMarkerId: state.selectedMarkerId,
    selectedTransitionId: state.selectedTransitionId,
    selectedTrackId: state.selectedTrackId,
    selectedTrackIds: [...state.selectedTrackIds],
    activeTrackId: state.activeTrackId,
    selectionType: state.selectionType,
    activeTool: state.activeTool,
    activeSnapTarget: state.activeSnapTarget,
    activeLinkedDropTarget: state.activeLinkedDropTarget,
    dragState: state.dragState,
    editKeyframePanelOpen: state.editKeyframePanelOpen,
    expandedKeyframeLanes: new Set(state.expandedKeyframeLanes),
  }
}

function captureMutationState() {
  const history = useTimelineCommandStore.getState()
  return {
    items: structuredClone(useItemsStore.getState().items),
    tracks: structuredClone(useItemsStore.getState().tracks),
    isDirty: useTimelineSettingsStore.getState().isDirty,
    undoStack: structuredClone(history.undoStack),
    redoStack: structuredClone(history.redoStack),
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }
}

function RenderedDragSurface({
  item,
  tracks,
  onClipClick,
  onBackgroundClick,
}: {
  item: TimelineItem
  tracks: TimelineTrack[]
  onClipClick?: () => void
  onBackgroundClick?: () => void
}) {
  const { handleDragStart } = useTimelineDrag(item, TIMELINE_DURATION)
  const [, rerender] = useState(0)

  return (
    <div
      className="timeline-container"
      data-testid="timeline-background"
      onClick={() => {
        onBackgroundClick?.()
        const selection = useSelectionStore.getState()
        selection.clearItemSelection()
        selection.selectMarker(null)
        rerender((value) => value + 1)
      }}
    >
      <div className="timeline-tracks">
        {[...tracks]
          .sort((left, right) => left.order - right.order)
          .map((track) => (
            <div data-track-id={track.id} key={track.id}>
              {track.id === item.trackId && (
                <button
                  data-item-id={item.id}
                  data-testid="drag-anchor"
                  type="button"
                  onMouseDown={handleDragStart}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClipClick?.()
                    const currentItems = useItemsStore.getState().items
                    useSelectionStore
                      .getState()
                      .selectItems(getLinkedItemIds(currentItems, item.id))
                    rerender((value) => value + 1)
                  }}
                >
                  {item.id}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}

function renderDragSurface(item: TimelineItem, tracks: TimelineTrack[]) {
  const onClipClick = vi.fn()
  const onBackgroundClick = vi.fn()
  const view = render(
    <RenderedDragSurface
      item={item}
      tracks={tracks}
      onClipClick={onClipClick}
      onBackgroundClick={onBackgroundClick}
    />,
  )
  const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-track-id]'))
  const centerYByTrackId = new Map<string, number>()
  rows.forEach((row, index) => {
    const top = index * TRACK_HEIGHT
    row.getBoundingClientRect = () => makeRect(top, top + TRACK_HEIGHT)
    centerYByTrackId.set(row.dataset.trackId!, top + TRACK_HEIGHT / 2)
  })
  const trackContainer = view.container.querySelector<HTMLElement>('.timeline-tracks')!
  const timelineContainer = view.container.querySelector<HTMLElement>('.timeline-container')!
  trackContainer.getBoundingClientRect = () =>
    makeRect(-TRACK_HEIGHT, rows.length * TRACK_HEIGHT + TRACK_HEIGHT)
  timelineContainer.getBoundingClientRect = trackContainer.getBoundingClientRect

  return {
    ...view,
    anchor: view.getByTestId('drag-anchor'),
    background: view.getByTestId('timeline-background'),
    centerYByTrackId,
    onClipClick,
    onBackgroundClick,
  }
}

function flushAnimationFrames() {
  const callbacks = Array.from(rafCallbacks.values())
  rafCallbacks.clear()
  for (const callback of callbacks) callback(performance.now())
}

function dispatchClick(target: Element) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}

function dragRendered(params: {
  anchor: Element
  startX?: number
  startY: number
  endX: number
  endY: number
  clickTarget: Element
}) {
  const startX = params.startX ?? 0
  fireEvent.mouseDown(params.anchor, { button: 0, clientX: startX, clientY: params.startY })
  fireEvent.mouseMove(window, { clientX: startX + 4, clientY: params.startY })
  act(flushAnimationFrames)
  fireEvent.mouseMove(window, { clientX: params.endX, clientY: params.endY })
  act(flushAnimationFrames)
  fireEvent.mouseUp(window, { button: 0, clientX: params.endX, clientY: params.endY })
  act(() => dispatchClick(params.clickTarget))
}

function makeBasicLinkedCohort() {
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
  return { video, audio }
}

function makePreflightRejectionCase(
  kind: 'nested' | 'deep' | 'implicit-nested' | 'missing' | 'cycle' | 'implicit-cycle',
) {
  const { video, audio } = makeBasicLinkedCohort()
  const baseTracks = [
    makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
    makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
    makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
    makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
  ]

  if (kind === 'nested' || kind === 'deep') {
    const depth = kind === 'deep' ? 4 : 2
    const groups = Array.from({ length: depth }, (_, index) =>
      makeTimelineTrack({
        id: `source-group-${index}`,
        name: `Source Group ${index}`,
        order: 4 + index,
        isGroup: true,
        locked: index === 0,
        parentTrackId: index === 0 ? undefined : `source-group-${index - 1}`,
      }),
    )
    const source = makeTimelineTrack({
      id: 'source-lane',
      name: 'Source Lane',
      kind: 'video',
      order: 4 + depth,
      parentTrackId: `source-group-${depth - 1}`,
    })
    return {
      tracks: [...baseTracks, ...groups, source],
      items: [{ ...video, trackId: source.id }, audio],
      anchor: { ...video, trackId: source.id },
    }
  }

  if (kind === 'implicit-nested') {
    const outer = makeTimelineTrack({
      id: 'audio-outer',
      name: 'Audio Outer',
      order: 4,
      isGroup: true,
      locked: true,
    })
    const inner = makeTimelineTrack({
      id: 'audio-inner',
      name: 'Audio Inner',
      order: 5,
      isGroup: true,
      parentTrackId: outer.id,
    })
    const companion = makeTimelineTrack({
      id: 'companion-lane',
      name: 'Companion Lane',
      kind: 'audio',
      order: 6,
      parentTrackId: inner.id,
    })
    return {
      tracks: [...baseTracks, outer, inner, companion],
      items: [video, { ...audio, trackId: companion.id }],
      anchor: video,
    }
  }

  if (kind === 'missing') {
    const source = makeTimelineTrack({
      id: 'missing-source',
      name: 'Missing Source',
      kind: 'video',
      order: 4,
      parentTrackId: 'absent-parent',
    })
    return {
      tracks: [...baseTracks, source],
      items: [{ ...video, trackId: source.id }, audio],
      anchor: { ...video, trackId: source.id },
    }
  }

  const cycleA = makeTimelineTrack({
    id: 'cycle-a',
    name: 'Cycle A',
    order: 4,
    isGroup: true,
    parentTrackId: 'cycle-b',
  })
  const cycleB = makeTimelineTrack({
    id: 'cycle-b',
    name: 'Cycle B',
    order: 5,
    isGroup: true,
    parentTrackId: 'cycle-a',
  })
  const cyclicLane = makeTimelineTrack({
    id: 'cyclic-lane',
    name: 'Cyclic Lane',
    kind: kind === 'implicit-cycle' ? 'audio' : 'video',
    order: 6,
    parentTrackId: cycleA.id,
  })
  return kind === 'implicit-cycle'
    ? {
        tracks: [...baseTracks, cycleA, cycleB, cyclicLane],
        items: [video, { ...audio, trackId: cyclicLane.id }],
        anchor: video,
      }
    : {
        tracks: [...baseTracks, cycleA, cycleB, cyclicLane],
        items: [{ ...video, trackId: cyclicLane.id }, audio],
        anchor: { ...video, trackId: cyclicLane.id },
      }
}

describe('useTimelineDrag rendered click ownership', () => {
  beforeEach(() => {
    rafCallbacks = new Map()
    nextRafId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextRafId++
      rafCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafCallbacks.delete(id))
  })

  afterEach(() => {
    resetPostTimelineGestureClickForTest()
    vi.unstubAllGlobals()
  })

  it.each([
    ['row 24 nested locked source', 'nested'],
    ['row 25 four-level locked source', 'deep'],
    ['row 26 nested locked implicit companion', 'implicit-nested'],
    ['row 28 missing source parent', 'missing'],
    ['row 30 cyclic source', 'cycle'],
    ['row 32 cyclic implicit companion', 'implicit-cycle'],
  ] as const)('%s rejects and owns its rendered post-mouseup click', (_name, kind) => {
    const { tracks, items, anchor } = makePreflightRejectionCase(kind)
    setupStores(tracks, items)
    useSelectionStore.getState().selectTrack(anchor.trackId)
    const beforeSelection = captureSelectionMetadata()
    const beforeMutation = captureMutationState()
    const view = renderDragSurface(anchor, tracks)
    const startY = view.centerYByTrackId.get(anchor.trackId)!

    dragRendered({
      anchor: view.anchor,
      startY,
      endX: 30,
      endY: startY,
      clickTarget: view.background,
    })

    expect(view.onBackgroundClick).not.toHaveBeenCalled()
    expect(captureSelectionMetadata()).toEqual(beforeSelection)
    expect(captureMutationState()).toEqual(beforeMutation)
  })

  it.each([
    ['row 34 selected cohort', true, false],
    ['row 41 unselected cohort with history', false, true],
  ] as const)(
    '%s restores the complete selection and mutation state after locked-target rejection',
    (_name, initiallySelected, seedHistory) => {
      const tracks = [
        makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0, locked: true }),
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ]
      const { video, audio } = makeBasicLinkedCohort()
      const prior = makeTimelineVideoItem({
        id: 'prior-selection',
        trackId: 'v1',
        from: 100,
        mediaId: 'prior-media',
      })
      setupStores(tracks, [video, audio, prior])
      useSelectionStore
        .getState()
        .selectItems(initiallySelected ? [video.id, audio.id] : [prior.id])
      useSelectionStore.getState().setEditKeyframePanelOpen(true)
      if (seedHistory) {
        useTimelineStore.getState().moveItem(prior.id, prior.from + 1)
      } else {
        useTimelineSettingsStore.setState({ isDirty: true })
      }
      const beforeSelection = captureSelectionMetadata()
      const beforeMutation = captureMutationState()
      const view = renderDragSurface(video, tracks)

      dragRendered({
        anchor: view.anchor,
        startY: view.centerYByTrackId.get('v1')!,
        endX: 30,
        endY: view.centerYByTrackId.get('v2')!,
        clickTarget: view.background,
      })

      expect(view.onBackgroundClick).not.toHaveBeenCalled()
      expect(captureSelectionMetadata()).toEqual(beforeSelection)
      expect(captureMutationState()).toEqual(beforeMutation)
    },
  )

  it('row 35 restores prior item, track, and keyframe metadata below threshold', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]
    const { video, audio } = makeBasicLinkedCohort()
    const prior = makeTimelineVideoItem({
      id: 'prior-selection',
      trackId: 'v1',
      from: 100,
      mediaId: 'prior-media',
    })
    setupStores(tracks, [video, audio, prior])
    useSelectionStore.setState({
      selectedItemIds: [prior.id],
      selectedItemIdSet: new Set([prior.id]),
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectedTrackId: 'v1',
      selectedTrackIds: ['v1'],
      activeTrackId: 'v1',
      selectionType: 'item',
      editKeyframePanelOpen: true,
      expandedKeyframeLanes: new Set([prior.id]),
    })
    const beforeSelection = captureSelectionMetadata()
    const beforeMutation = captureMutationState()
    const view = renderDragSurface(video, tracks)
    const startY = view.centerYByTrackId.get('v1')!

    fireEvent.mouseDown(view.anchor, { button: 0, clientX: 10, clientY: startY })
    fireEvent.mouseMove(window, { clientX: 12, clientY: startY })
    fireEvent.mouseUp(window, { button: 0, clientX: 12, clientY: startY })
    act(() => dispatchClick(view.anchor))

    expect(view.onClipClick).not.toHaveBeenCalled()
    expect(captureSelectionMetadata()).toEqual(beforeSelection)
    expect(captureMutationState()).toEqual(beforeMutation)
  })

  it.each(['marker', 'transition'] as const)(
    'restores a prior %s selection after a rendered below-threshold cancellation',
    (selectionType) => {
      const tracks = [
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ]
      const { video, audio } = makeBasicLinkedCohort()
      setupStores(tracks, [video, audio])
      useSelectionStore.getState().selectTrack('v1')
      if (selectionType === 'marker') {
        useSelectionStore.getState().selectMarker('marker-1')
      } else {
        useSelectionStore.getState().selectTransition('transition-1')
      }
      const beforeSelection = captureSelectionMetadata()
      const view = renderDragSurface(video, tracks)
      const startY = view.centerYByTrackId.get('v1')!

      fireEvent.mouseDown(view.anchor, { button: 0, clientX: 10, clientY: startY })
      fireEvent.mouseMove(window, { clientX: 12, clientY: startY })
      fireEvent.mouseUp(window, { button: 0, clientX: 12, clientY: startY })
      act(() => dispatchClick(view.anchor))

      expect(view.onClipClick).not.toHaveBeenCalled()
      expect(captureSelectionMetadata()).toEqual(beforeSelection)
    },
  )

  it('row 42 preserves malformed-source full state and the prior keyframe target', () => {
    const malformed = makePreflightRejectionCase('missing')
    const prior = makeTimelineVideoItem({
      id: 'prior-selection',
      trackId: 'v1',
      from: 100,
      mediaId: 'prior-media',
    })
    setupStores(malformed.tracks, [...malformed.items, prior])
    useSelectionStore.getState().selectItems([prior.id])
    useSelectionStore.getState().setEditKeyframePanelOpen(true)
    useTimelineSettingsStore.setState({ isDirty: true })
    const beforeSelection = captureSelectionMetadata()
    const beforeMutation = captureMutationState()
    const view = renderDragSurface(malformed.anchor, malformed.tracks)
    const startY = view.centerYByTrackId.get(malformed.anchor.trackId)!

    dragRendered({
      anchor: view.anchor,
      startY,
      endX: 30,
      endY: startY,
      clickTarget: view.background,
    })

    expect(view.onBackgroundClick).not.toHaveBeenCalled()
    expect(captureSelectionMetadata()).toEqual(beforeSelection)
    expect(captureMutationState()).toEqual(beforeMutation)
  })

  it.each(['Escape', 'pointercancel'] as const)(
    'restores exact state when an active gesture ends via %s',
    (cancellation) => {
      const tracks = [
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ]
      const { video, audio } = makeBasicLinkedCohort()
      const prior = makeTimelineVideoItem({
        id: 'prior-selection',
        trackId: 'v1',
        from: 100,
        mediaId: 'prior-media',
      })
      setupStores(tracks, [video, audio, prior])
      useSelectionStore.getState().selectItems([prior.id])
      const beforeSelection = captureSelectionMetadata()
      const beforeMutation = captureMutationState()
      const view = renderDragSurface(video, tracks)
      const startY = view.centerYByTrackId.get('v1')!

      fireEvent.mouseDown(view.anchor, { button: 0, clientX: 0, clientY: startY })
      fireEvent.mouseMove(window, { clientX: 4, clientY: startY })
      act(flushAnimationFrames)
      if (cancellation === 'Escape') {
        fireEvent.keyDown(window, { key: 'Escape' })
      } else {
        window.dispatchEvent(new Event('pointercancel', { bubbles: true }))
      }
      act(() => dispatchClick(view.background))

      expect(view.onBackgroundClick).not.toHaveBeenCalled()
      expect(captureSelectionMetadata()).toEqual(beforeSelection)
      expect(captureMutationState()).toEqual(beforeMutation)
    },
  )

  it.each(['source', 'destination'] as const)(
    'revalidates live %s lock drift and owns the rendered release click',
    (lockDrift) => {
      const tracks = [
        makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ]
      const { video, audio } = makeBasicLinkedCohort()
      const prior = makeTimelineVideoItem({
        id: 'prior-selection',
        trackId: 'v1',
        from: 100,
        mediaId: 'prior-media',
      })
      setupStores(tracks, [video, audio, prior])
      useSelectionStore.getState().selectItems([prior.id])
      const beforeSelection = captureSelectionMetadata()
      const view = renderDragSurface(video, tracks)
      const startY = view.centerYByTrackId.get('v1')!
      const endY = view.centerYByTrackId.get('v2')!

      fireEvent.mouseDown(view.anchor, { button: 0, clientX: 0, clientY: startY })
      fireEvent.mouseMove(window, { clientX: 4, clientY: startY })
      act(flushAnimationFrames)
      fireEvent.mouseMove(window, { clientX: 30, clientY: endY })
      act(flushAnimationFrames)
      act(() => {
        useItemsStore
          .getState()
          .setTracks(
            tracks.map((track) =>
              track.id === (lockDrift === 'source' ? 'v1' : 'v2')
                ? { ...track, locked: true }
                : track,
            ),
          )
      })
      const beforeDropMutation = captureMutationState()
      fireEvent.mouseUp(window, { button: 0, clientX: 30, clientY: endY })
      act(() => dispatchClick(view.background))

      expect(view.onBackgroundClick).not.toHaveBeenCalled()
      expect(captureSelectionMetadata()).toEqual(beforeSelection)
      expect(captureMutationState()).toEqual(beforeDropMutation)
    },
  )

  it('restores on unmount without swallowing the next independent click', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]
    const { video, audio } = makeBasicLinkedCohort()
    const prior = makeTimelineVideoItem({
      id: 'prior-selection',
      trackId: 'v1',
      from: 100,
      mediaId: 'prior-media',
    })
    setupStores(tracks, [video, audio, prior])
    useSelectionStore.getState().selectItems([prior.id])
    const beforeSelection = captureSelectionMetadata()
    const view = renderDragSurface(video, tracks)
    const startY = view.centerYByTrackId.get('v1')!

    fireEvent.mouseDown(view.anchor, { button: 0, clientX: 0, clientY: startY })
    fireEvent.mouseMove(window, { clientX: 2, clientY: startY })
    view.unmount()

    expect(captureSelectionMetadata()).toEqual(beforeSelection)

    const independent = document.createElement('button')
    const onIndependentClick = vi.fn()
    independent.addEventListener('click', onIndependentClick)
    document.body.appendChild(independent)
    fireEvent.mouseDown(independent)
    fireEvent.mouseUp(independent)
    dispatchClick(independent)
    expect(onIndependentClick).toHaveBeenCalledTimes(1)
  })

  it('allows a no-move ordinary click and a Razor click', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]
    const { video, audio } = makeBasicLinkedCohort()
    setupStores(tracks, [video, audio])
    useSelectionStore.getState().selectTrack('v1')
    const view = renderDragSurface(video, tracks)
    const startY = view.centerYByTrackId.get('v1')!

    fireEvent.mouseDown(view.anchor, { button: 0, clientX: 10, clientY: startY })
    fireEvent.mouseUp(window, { button: 0, clientX: 10, clientY: startY })
    act(() => dispatchClick(view.anchor))

    expect(view.onClipClick).toHaveBeenCalledTimes(1)
    expect(new Set(useSelectionStore.getState().selectedItemIds)).toEqual(
      new Set([video.id, audio.id]),
    )

    const razor = document.createElement('button')
    const onRazorClick = vi.fn()
    razor.addEventListener('click', onRazorClick)
    document.body.appendChild(razor)
    fireEvent.mouseDown(razor)
    fireEvent.mouseUp(razor)
    dispatchClick(razor)
    expect(onRazorClick).toHaveBeenCalledTimes(1)
  })

  it('keeps successful linked-drop selection and allows the next independent click', () => {
    const tracks = [
      makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ]
    const { video, audio } = makeBasicLinkedCohort()
    setupStores(tracks, [video, audio])
    const view = renderDragSurface(video, tracks)

    dragRendered({
      anchor: view.anchor,
      startY: view.centerYByTrackId.get('v1')!,
      endX: 30,
      endY: view.centerYByTrackId.get('v2')!,
      clickTarget: view.background,
    })

    expect(view.onBackgroundClick).not.toHaveBeenCalled()
    expect(new Set(useSelectionStore.getState().selectedItemIds)).toEqual(
      new Set([video.id, audio.id]),
    )
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    fireEvent.mouseDown(view.background)
    fireEvent.mouseUp(view.background)
    act(() => dispatchClick(view.background))
    expect(view.onBackgroundClick).toHaveBeenCalledTimes(1)
  })
})
