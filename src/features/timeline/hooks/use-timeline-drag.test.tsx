import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineDrag } from './use-timeline-drag'

const ITEM = makeTimelineVideoItem()

function startDrag(result: { current: ReturnType<typeof useTimelineDrag> }) {
  const target = document.createElement('div')
  const event = {
    button: 0,
    clientX: 100,
    clientY: 100,
    ctrlKey: false,
    metaKey: false,
    target,
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent

  act(() => {
    result.current.handleDragStart(event)
  })
}

describe('useTimelineDrag', () => {
  beforeEach(() => {
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: ITEM.trackId, name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([ITEM])
    useTimelineSettingsStore.setState({ fps: 30, snapEnabled: false })
    useTransitionsStore.getState().setTransitions([])
    useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
    useEditorStore.setState({ linkedSelectionEnabled: false })
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setDragState(null)
  })

  it('defers drag cohort geometry until movement crosses the threshold', () => {
    const tracks = document.createElement('div')
    tracks.className = 'timeline-tracks'
    const trackRow = document.createElement('div')
    trackRow.dataset.trackId = ITEM.trackId
    const readTrackRect = vi
      .spyOn(trackRow, 'getBoundingClientRect')
      .mockReturnValue({ top: 0 } as DOMRect)
    tracks.appendChild(trackRow)
    document.body.appendChild(tracks)

    const { result } = renderHook(() => useTimelineDrag(ITEM, 600))
    startDrag(result)

    expect(useSelectionStore.getState().selectedItemIds).toEqual([ITEM.id])
    expect(useSelectionStore.getState().dragState).toBeNull()
    expect(readTrackRect).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 100 }))
    })

    expect(readTrackRect).toHaveBeenCalledTimes(1)
    expect(useSelectionStore.getState().dragState?.draggedItemIds).toEqual([ITEM.id])

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 110, clientY: 100 }))
    })
    tracks.remove()
  })
})
