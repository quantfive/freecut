import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore } from '../stores/items-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store'
import { useSelectionStore } from '@/shared/state/selection'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '../test-helpers'
import { TrackPushHandle } from '../components/timeline-item/track-push-handle'
import { useTrackPush } from './use-track-push'
function Surface() {
  const owner = useRef<HTMLDivElement>(null)
  const item = useItemsStore((s) => s.items.find((i) => i.id === 'anchor')!)
  const push = useTrackPush(item, 600, false, owner)
  return (
    <div data-editor-workspace-shell data-testid="outer">
      <div data-editor-workspace-shell data-testid="root">
        <div ref={owner} />
        <TrackPushHandle
          enabled
          isActive={push.isTrackPushActive}
          clipLeftStyle="60px"
          zoneStyle="20px"
          onMouseDown={push.handleTrackPushStart}
        />
      </div>
      <div data-editor-workspace-shell data-testid="foreign" />
    </div>
  )
}
function cancel(el: Element) {
  act(() => {
    el.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
  })
}
function snapshot() {
  return structuredClone(useItemsStore.getState().items)
}
function start(view: ReturnType<typeof render>) {
  fireEvent.mouseDown(view.container.querySelector('[data-track-push]')!, { button: 0, clientX: 0 })
}
beforeEach(() => {
  resetTimelineCompositionTestState()
  useTimelineSettingsStore.setState({ fps: 30, snapEnabled: false })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'v', name: 'V1', order: 0 }),
      makeTimelineTrack({ id: 'v2', name: 'V2', order: 1 }),
    ])
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: 'static', trackId: 'v', from: 0, durationInFrames: 30 }),
      makeTimelineVideoItem({ id: 'anchor', trackId: 'v', from: 60 }),
      makeTimelineVideoItem({ id: 'later', trackId: 'v2', from: 90 }),
    ])
})
afterEach(cleanup)
describe('track push cancellation', () => {
  it.each([0, 15, -15])('cancels press/active delta %s before late release', (delta) => {
    const view = render(<Surface />),
      before = snapshot()
    start(view)
    if (delta) fireEvent.mouseMove(window, { clientX: delta })
    expect(useTrackPushPreviewStore.getState().delta).toBe(delta)
    cancel(view.getByTestId('root'))
    cancel(view.getByTestId('root'))
    fireEvent.mouseMove(window, { clientX: 25 })
    fireEvent.mouseUp(window)
    expect(snapshot()).toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(useTrackPushPreviewStore.getState().anchorItemId).toBeNull()
    expect(useSelectionStore.getState().dragState).toBeNull()
  })
  it.each([15, -15])('foreign roots/rerender preserve normal delta %s and one undo', (delta) => {
    const view = render(<Surface />),
      before = snapshot()
    start(view)
    fireEvent.mouseMove(window, { clientX: delta })
    view.rerender(<Surface />)
    cancel(view.getByTestId('foreign'))
    cancel(view.getByTestId('outer'))
    fireEvent.mouseUp(window)
    fireEvent.mouseUp(window)
    expect(useItemsStore.getState().items.find((i) => i.id === 'anchor')?.from).toBe(60 + delta)
    expect(useItemsStore.getState().items.find((i) => i.id === 'later')?.from).toBe(90 + delta)
    expect(useItemsStore.getState().items.find((i) => i.id === 'static')?.from).toBe(0)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    act(() => useTimelineCommandStore.getState().undo())
    expect(snapshot()).toEqual(before)
  })
  it('unmount cancels active push', () => {
    const view = render(<Surface />),
      before = snapshot()
    start(view)
    fireEvent.mouseMove(window, { clientX: 15 })
    view.unmount()
    fireEvent.mouseUp(window)
    expect(snapshot()).toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(useSelectionStore.getState().dragState).toBeNull()
  })
})
