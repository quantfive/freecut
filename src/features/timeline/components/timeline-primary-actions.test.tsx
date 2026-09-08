import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from 'sonner'
import { useItemsStore } from '../stores/items-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineStore } from '../stores/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { makeTimelineTrack, makeTimelineVideoItem, makeTimelineAudioItem } from '../test-helpers'
import { TimelinePrimaryActions } from './timeline-primary-actions'

const context = vi.hoisted(() => ({
  mode: 'host',
  timeline: { requestRippleDelete: vi.fn() },
  denied: '',
}))
vi.mock('../deps/editor', () => ({
  useEditorHostContext: () => context,
  useEditorCapability: (capability: string) => capability !== context.denied,
}))

describe('timeline primary actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    context.timeline.requestRippleDelete.mockReset()
    context.denied = ''
    context.mode = 'host'
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v', name: 'Video', order: 0 }),
        makeTimelineTrack({ id: 'a', name: 'Audio', order: 1, kind: 'audio' }),
      ])
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({ id: 'clip', trackId: 'v', from: 0, durationInFrames: 60 }),
      ])
    useSelectionStore.getState().selectItems(['clip'])
    usePlaybackStore.setState({ currentFrame: 30 })
  })

  it('routes host delete once through the authority without local deletion', () => {
    const localDelete = vi.spyOn(useTimelineStore.getState(), 'rippleDeleteItems')
    render(<TimelinePrimaryActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete & close gap' }))
    expect(context.timeline.requestRippleDelete).toHaveBeenCalledExactlyOnceWith(['clip'])
    expect(localDelete).not.toHaveBeenCalled()
  })

  it('routes Split through the existing split action at the playhead', () => {
    const split = vi.spyOn(useTimelineStore.getState(), 'splitItem').mockImplementation(() => {})
    render(<TimelinePrimaryActions />)
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(split).toHaveBeenCalledExactlyOnceWith('clip', 30)
  })

  it('splits a selected linked A/V cohort once and restores both with one undo', () => {
    context.mode = 'standalone'
    useEditorStore.setState({ hostMode: false })
    useItemsStore
      .getState()
      .setItems([
        makeTimelineVideoItem({
          id: 'clip',
          trackId: 'v',
          linkedGroupId: 'pair',
          from: 0,
          durationInFrames: 60,
        }),
        makeTimelineAudioItem({
          id: 'audio',
          trackId: 'a',
          linkedGroupId: 'pair',
          from: 0,
          durationInFrames: 60,
        }),
      ])
    useSelectionStore.getState().selectItems(['clip', 'audio'])
    useTimelineCommandStore.getState().clearHistory()
    render(<TimelinePrimaryActions />)
    expect(screen.getByRole('button', { name: 'Split' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(useItemsStore.getState().items).toHaveLength(4)
    for (const trackId of ['v', 'a']) {
      expect(
        useItemsStore
          .getState()
          .items.filter((item) => item.trackId === trackId)
          .map((item) => [item.from, item.durationInFrames]),
      ).toEqual([
        [0, 30],
        [30, 30],
      ])
    }
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    act(() => useTimelineStore.temporal.getState().undo())
    expect(
      useItemsStore.getState().items.map((item) => [item.id, item.from, item.durationInFrames]),
    ).toEqual([
      ['clip', 0, 60],
      ['audio', 0, 60],
    ])
  })

  it.each([false, true])(
    'keeps unrelated multi-selection disabled with linked selection %s',
    (linkedSelectionEnabled) => {
      useEditorStore.setState({ linkedSelectionEnabled })
      useItemsStore
        .getState()
        .setItems([
          makeTimelineVideoItem({ id: 'clip', trackId: 'v', from: 0, durationInFrames: 60 }),
          makeTimelineAudioItem({ id: 'audio', trackId: 'a', from: 0, durationInFrames: 60 }),
        ])
      useSelectionStore.getState().selectItems(['clip', 'audio'])
      render(<TimelinePrimaryActions />)
      expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
    },
  )

  it('disables delete when the host denies timeline.remove', () => {
    context.denied = 'timeline.remove'
    render(<TimelinePrimaryActions />)
    expect(screen.getByRole('button', { name: 'Delete & close gap' })).toBeDisabled()
  })

  it('protects an unselected locked linked companion for split and delete', () => {
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v', name: 'Video', order: 0 }),
        makeTimelineTrack({ id: 'a', name: 'Audio', order: 1, kind: 'audio', locked: true }),
      ])
    useItemsStore.getState().setItems([
      makeTimelineVideoItem({
        id: 'clip',
        trackId: 'v',
        linkedGroupId: 'pair',
        from: 0,
        durationInFrames: 60,
      }),
      makeTimelineAudioItem({
        id: 'audio',
        trackId: 'a',
        linkedGroupId: 'pair',
        from: 0,
        durationInFrames: 60,
      }),
    ])
    render(<TimelinePrimaryActions />)
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete & close gap' })).toBeDisabled()
  })

  it('handles rejected delete without clearing the selection or mutating items', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    context.timeline.requestRippleDelete.mockRejectedValue(new Error('rejected'))
    render(<TimelinePrimaryActions />)
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Delete & close gap' })),
    )
    expect(error).toHaveBeenCalledWith(expect.stringContaining('try again'))
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip'])
    expect(useItemsStore.getState().items).toHaveLength(1)
  })
})
