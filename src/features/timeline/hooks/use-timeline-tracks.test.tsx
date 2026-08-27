import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore } from '../stores/items-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { makeTimelineTrack } from '../test-helpers'
import { useTimelineTracks } from './use-timeline-tracks'

describe('useTimelineTracks solo contract', () => {
  beforeEach(() => {
    useItemsStore.getState().setItems([])
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ isDirty: false })
  })

  it('keeps multiple stems soloed and toggles each track independently', () => {
    const { result } = renderHook(() => useTimelineTracks())

    act(() => result.current.toggleTrackSolo('v1'))
    act(() => result.current.toggleTrackSolo('a1'))

    expect(useItemsStore.getState().tracks.map(({ id, solo }) => ({ id, solo }))).toEqual([
      { id: 'v1', solo: true },
      { id: 'a1', solo: true },
    ])

    act(() => result.current.toggleTrackSolo('v1'))

    expect(useItemsStore.getState().tracks.map(({ id, solo }) => ({ id, solo }))).toEqual([
      { id: 'v1', solo: false },
      { id: 'a1', solo: true },
    ])
  })
})
