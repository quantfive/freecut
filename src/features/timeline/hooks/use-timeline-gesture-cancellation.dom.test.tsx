import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'
import { useSlipEditPreviewStore } from '../stores/slip-edit-preview-store'
import { useSlideEditPreviewStore } from '../stores/slide-edit-preview-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useTimelineDrag } from './use-timeline-drag'
import { useTimelineTrim } from './use-timeline-trim'
import { useTimelineSlipSlide } from './use-timeline-slip-slide'
import { useRateStretch } from './use-rate-stretch'
import { useTimelineGestureCancellation } from './use-timeline-gesture-cancellation'

type Tool = 'move' | 'trim' | 'slip' | 'slide' | 'stretch'
let frames = new Map<number, FrameRequestCallback>()
let id = 0
let clip: TimelineItem

function Surface({ tool, pending = false }: { tool: Tool; pending?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useTimelineDrag(clip, 600, false, ref)
  const trim = useTimelineTrim(clip, 600, false, ref)
  const slip = useTimelineSlipSlide(clip, 600, false, ref)
  const stretch = useRateStretch(clip, 600, false, ref)
  return (
    <div data-editor-workspace-shell data-testid="outer">
      <div data-editor-workspace-shell data-testid="root" className="timeline-container">
        <div className="timeline-tracks">
          <div data-track-id="track-v1">
            <div
              ref={ref}
              data-item-id="center"
              data-testid="clip"
              onMouseDown={(event) => {
                if (tool === 'move') drag.handleDragStart(event)
                if (tool === 'trim') trim.handleTrimStart(event, 'end')
                if (tool === 'slip' || tool === 'slide')
                  slip.handleSlipSlideStart(event, tool, { activateOnMoveThreshold: pending })
                if (tool === 'stretch') stretch.handleStretchStart(event, 'end')
              }}
            >
              clip
            </div>
          </div>
        </div>
      </div>
      <div data-editor-workspace-shell data-testid="foreign" />
    </div>
  )
}

function mount(tool: Tool, pending = false) {
  if (tool === 'move') useItemsStore.getState().setItems([clip])
  const view = render(<Surface tool={tool} pending={pending} />)
  for (const el of view.container.querySelectorAll<HTMLElement>(
    '.timeline-container,.timeline-tracks,[data-track-id]',
  )) {
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      bottom: 80,
      left: 0,
      right: 1000,
      width: 1000,
      height: 80,
      toJSON: () => ({}),
    })
  }
  return view
}
function move(x: number) {
  fireEvent.mouseMove(window, { clientX: x, clientY: 40 })
  act(() => {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach((cb) => cb(performance.now()))
  })
}
function cancel(root: Element) {
  act(() => {
    root.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
  })
}
function start(view: ReturnType<typeof mount>) {
  fireEvent.mouseDown(view.getByTestId('clip'), { button: 0, clientX: 0, clientY: 40 })
}
function items() {
  return structuredClone(useItemsStore.getState().items)
}
function expectIdle(before: TimelineItem[]) {
  expect(items()).toEqual(before)
  expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  expect(useSelectionStore.getState().dragState).toBeNull()
  expect(useLinkedEditPreviewStore.getState().updatesById).toEqual({})
}

beforeEach(() => {
  resetTimelineCompositionTestState()
  useTimelineSettingsStore.setState({ fps: 30, snapEnabled: false, isDirty: false })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useEditorStore.setState({ linkedSelectionEnabled: false, hostMode: false })
  useSelectionStore.getState().clearSelection()
  useItemsStore
    .getState()
    .setTracks([makeTimelineTrack({ id: 'track-v1', kind: 'video', name: 'Video', order: 0 })])
  clip = makeTimelineVideoItem({
    id: 'center',
    trackId: 'track-v1',
    from: 60,
    durationInFrames: 60,
    sourceStart: 30,
    sourceEnd: 90,
    sourceDuration: 300,
  })
  useItemsStore.getState().setItems([
    makeTimelineVideoItem({
      id: 'left',
      trackId: 'track-v1',
      from: 0,
      durationInFrames: 60,
      sourceStart: 30,
      sourceEnd: 90,
      sourceDuration: 300,
    }),
    clip,
    makeTimelineVideoItem({
      id: 'right',
      trackId: 'track-v1',
      from: 120,
      durationInFrames: 60,
      sourceStart: 30,
      sourceEnd: 90,
      sourceDuration: 300,
    }),
  ])
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('owner-scoped complete gesture lifecycle', () => {
  it.each<Tool>(['move', 'slip', 'slide'])(
    'cancels pending %s before threshold, including duplicate cancellation and late up',
    (tool) => {
      const view = mount(tool, true)
      const before = items()
      start(view)
      cancel(view.getByTestId('root'))
      cancel(view.getByTestId('root'))
      move(6)
      move(tool === 'trim' ? -15 : 15)
      fireEvent.mouseUp(window)
      expectIdle(before)
    },
  )
  it.each<Tool>(['move', 'trim', 'slip', 'slide', 'stretch'])(
    'cancels active %s and queued work before late up',
    (tool) => {
      const view = mount(tool)
      const before = items()
      start(view)
      move(6)
      move(tool === 'trim' ? -15 : 15)
      expect(useSelectionStore.getState().dragState).not.toBeNull()
      if (tool === 'slip') expect(useSlipEditPreviewStore.getState().slipDelta).not.toBe(0)
      if (tool === 'slide') expect(useSlideEditPreviewStore.getState().slideDelta).not.toBe(0)
      // Queue a final RAF move, then cancel synchronously before it runs.
      fireEvent.mouseMove(window, { clientX: tool === 'trim' ? -18 : 18, clientY: 40 })
      cancel(view.getByTestId('root'))
      cancel(view.getByTestId('root'))
      move(tool === 'trim' ? -20 : 20)
      fireEvent.mouseUp(window)
      expectIdle(before)
    },
  )
  it.each<Tool>(['move', 'trim', 'slip', 'slide', 'stretch'])(
    'foreign root and rerender preserve %s, commit once and undo restores',
    (tool) => {
      // Body movement needs free space; other edits use contiguous neighbors.
      if (tool === 'move') useItemsStore.getState().setItems([clip])
      const view = mount(tool)
      const before = items()
      start(view)
      move(6)
      move(tool === 'trim' ? -15 : 15)
      view.rerender(<Surface tool={tool} />)
      cancel(view.getByTestId('foreign'))
      cancel(view.getByTestId('outer'))
      fireEvent.mouseUp(window)
      fireEvent.mouseUp(window)
      expect(items()).not.toEqual(before)
      const edited = useItemsStore.getState().items.find((item) => item.id === 'center')!
      if (tool === 'move' || tool === 'slide') expect(edited.from).toBe(75)
      if (tool === 'trim') expect(edited.durationInFrames).toBe(45)
      if (tool === 'slip') expect(edited.sourceStart).toBe(15)
      if (tool === 'stretch') {
        expect(edited.durationInFrames).toBe(75)
        expect(edited.speed).toBe(0.8)
      }
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
      act(() => useTimelineCommandStore.getState().undo())
      expect(items()).toEqual(before)
    },
  )
  it.each<Tool>(['move', 'trim', 'slip', 'slide', 'stretch'])(
    'true unmount cancels active %s',
    (tool) => {
      const view = mount(tool)
      const before = items()
      start(view)
      move(6)
      move(tool === 'trim' ? -15 : 15)
      view.unmount()
      move(25)
      fireEvent.mouseUp(window)
      expectIdle(before)
    },
  )
})

function CancellationOwner({ onCancel }: { onCancel: (update: boolean) => void }) {
  const owner = useRef<HTMLDivElement>(null)
  useTimelineGestureCancellation(owner, onCancel)
  return (
    <div data-editor-workspace-shell data-testid="owner">
      <div ref={owner} />
    </div>
  )
}

it('keeps a stable listener with the current callback and disposes only on true unmount', () => {
  const first = vi.fn()
  const second = vi.fn()
  const view = render(<CancellationOwner onCancel={first} />)
  view.rerender(<CancellationOwner onCancel={second} />)
  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
  cancel(view.getByTestId('owner'))
  expect(second).toHaveBeenCalledExactlyOnceWith(true)
  view.unmount()
  expect(second.mock.calls).toEqual([[true], [false]])
  window.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture'))
  expect(second).toHaveBeenCalledTimes(2)
})
