import { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSelectionStore } from '@/shared/state/selection'
import { subscribeSelectionDragActivity } from './shared-drag-activity'

function DragActivityProbe({ onChange }: { onChange: (active: boolean) => void }) {
  useEffect(() => subscribeSelectionDragActivity(onChange), [onChange])
  return null
}

describe('shared drag activity', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setDragState(null)
  })

  it('uses one selection-store subscription and publishes only drag activity changes', () => {
    const subscribe = vi.spyOn(useSelectionStore, 'subscribe')
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    render(
      <>
        <DragActivityProbe onChange={firstListener} />
        <DragActivityProbe onChange={secondListener} />
      </>,
    )

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(firstListener).toHaveBeenLastCalledWith(false)
    expect(secondListener).toHaveBeenLastCalledWith(false)

    act(() => {
      useSelectionStore.getState().selectItems(['clip-1'])
    })
    expect(firstListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledTimes(1)

    act(() => {
      useSelectionStore.getState().setDragState({
        isDragging: true,
        draggedItemIds: ['clip-1'],
        offset: { x: 0, y: 0 },
      })
    })
    expect(firstListener).toHaveBeenLastCalledWith(true)
    expect(secondListener).toHaveBeenLastCalledWith(true)
  })
})
