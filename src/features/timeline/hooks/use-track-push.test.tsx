import type { MouseEvent as ReactMouseEvent } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useTrackPushPreviewStore } from '../stores/track-push-preview-store'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { useTrackPush } from './use-track-push'

function makeMouseEvent(): ReactMouseEvent {
  return {
    button: 0,
    clientX: 100,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactMouseEvent
}

describe('useTrackPush lock preview', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useTimelineSettingsStore.setState({ fps: 30, snapEnabled: false })
    useTrackPushPreviewStore.getState().clearPreview()
    useSelectionStore.getState().setDragState(null)
    useSelectionStore.getState().setActiveSnapTarget(null)
  })

  it('previews eligible unlocked items without moving standalone locked-track items', () => {
    const video = makeTimelineVideoItem({ id: 'video', from: 30 })
    const lockedAudio = makeTimelineAudioItem({ id: 'audio', from: 30 })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({
        id: 'track-a1',
        name: 'A1',
        kind: 'audio',
        order: 1,
        locked: true,
      }),
    ])
    useItemsStore.getState().setItems([video, lockedAudio])
    const { result } = renderHook(() => useTrackPush(video, 10))

    act(() => result.current.handleTrackPushStart(makeMouseEvent()))

    expect(result.current.isTrackPushActive).toBe(true)
    expect([...useTrackPushPreviewStore.getState().shiftedItemIds]).toEqual([video.id])
  })

  it('does not start or create a preview when the anchor has a locked linked companion', () => {
    const video = makeTimelineVideoItem({
      id: 'video',
      from: 30,
      linkedGroupId: 'linked-av',
    })
    const audio = makeTimelineAudioItem({
      id: 'audio',
      from: 30,
      linkedGroupId: 'linked-av',
    })
    useItemsStore.getState().setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({
        id: 'track-a1',
        name: 'A1',
        kind: 'audio',
        order: 1,
        locked: true,
      }),
    ])
    useItemsStore.getState().setItems([video, audio])
    const { result } = renderHook(() => useTrackPush(video, 10))

    act(() => result.current.handleTrackPushStart(makeMouseEvent()))

    expect(result.current.isTrackPushActive).toBe(false)
    expect(useTrackPushPreviewStore.getState().anchorItemId).toBeNull()
    expect(useSelectionStore.getState().dragState).toBeNull()
  })
})
