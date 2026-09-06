import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore } from '@/shared/state/mic-recording-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { clearTimelineHover, setTimelineHover } from '../../utils/timeline-hover-state'
import { useToolShortcuts } from './use-tool-shortcuts'

const registrations = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; callback: (event: HotkeyEvent) => void }>,
}))

vi.mock('@/hooks/use-hotkey-registration', () => ({
  useCommandHotkey: vi.fn((command: string, callback: (event: HotkeyEvent) => void) => {
    registrations.calls.push({ command, callback })
  }),
}))

type HotkeyEvent = {
  preventDefault: () => void
}

const TRACK: TimelineTrack = {
  id: 'track-1',
  name: 'V1',
  kind: 'video',
  order: 0,
  height: 80,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
}

const ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: TRACK.id,
  from: 0,
  durationInFrames: 40,
  label: 'Clip 1',
  src: 'clip.mp4',
}

const SECOND_ITEM: VideoItem = {
  id: 'clip-2',
  type: 'video',
  trackId: TRACK.id,
  from: 40,
  durationInFrames: 40,
  label: 'Clip 2',
  src: 'clip-2.mp4',
}

function ShortcutHarness() {
  useToolShortcuts({})
  return null
}

function getRegistration(command: string) {
  const registration = registrations.calls.find((entry) => entry.command === command)
  expect(registration).toBeDefined()
  return registration!
}

describe('hover split and Razor shortcut ownership', () => {
  beforeEach(() => {
    registrations.calls = []
    clearTimelineHover()
    useSelectionStore.getState().clearSelection()
    useSelectionStore.setState({ activeTool: 'select' })
    useMicRecordingStore.setState({ status: 'idle' })
    useTimelineCommandStore.getState().clearHistory()
    usePlaybackStore.setState({
      currentFrame: 7,
      previewFrame: 25,
      previewItemId: ITEM.id,
      isPlaying: false,
    })
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM], transitions: [] })
  })

  afterEach(() => {
    clearTimelineHover()
  })

  it('does not split from a stale preview when C has no active clip hover', () => {
    render(<ShortcutHarness />)

    const event = { preventDefault: vi.fn() }
    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback(event)
    })

    expect(useTimelineStore.getState().items).toEqual([ITEM])
    expect(usePlaybackStore.getState().currentFrame).toBe(7)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('splits only the synchronously hovered clip frame without moving the playhead', () => {
    setTimelineHover(ITEM.id, 25)
    usePlaybackStore.setState({ previewFrame: null, previewItemId: null })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    const items = useTimelineStore
      .getState()
      .items.toSorted((left, right) => left.from - right.from)
    expect(items).toHaveLength(2)
    expect(items.map((item) => [item.from, item.durationInFrames])).toEqual([
      [0, 25],
      [25, 15],
    ])
    expect(usePlaybackStore.getState().currentFrame).toBe(7)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('prefers the synchronously hovered clip over the selected clip and current frame', () => {
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM, SECOND_ITEM], transitions: [] })
    useSelectionStore.getState().selectItems([SECOND_ITEM.id])
    usePlaybackStore.setState({ currentFrame: 55, previewFrame: 12, previewItemId: SECOND_ITEM.id })
    setTimelineHover(ITEM.id, 25)
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    const items = useTimelineStore
      .getState()
      .items.toSorted((left, right) => left.from - right.from)
    expect(items.map((item) => [item.from, item.durationInFrames])).toEqual([
      [0, 25],
      [25, 15],
      [40, 40],
    ])
  })

  it('falls back to the one selected clip at currentFrame when the pointer is away', () => {
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM, SECOND_ITEM], transitions: [] })
    useSelectionStore.getState().selectItems([SECOND_ITEM.id])
    usePlaybackStore.setState({ currentFrame: 55, previewFrame: 12, previewItemId: ITEM.id })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    const items = useTimelineStore
      .getState()
      .items.toSorted((left, right) => left.from - right.from)
    expect(items.map((item) => [item.from, item.durationInFrames])).toEqual([
      [0, 40],
      [40, 15],
      [55, 25],
    ])
  })

  it.each([SECOND_ITEM.from, SECOND_ITEM.from + SECOND_ITEM.durationInFrames])(
    'rejects a selected fallback at clip endpoint %s',
    (currentFrame) => {
      useTimelineStore.setState({ tracks: [TRACK], items: [ITEM, SECOND_ITEM], transitions: [] })
      useSelectionStore.getState().selectItems([SECOND_ITEM.id])
      usePlaybackStore.setState({ currentFrame, previewFrame: 12, previewItemId: ITEM.id })
      render(<ShortcutHarness />)

      act(() => {
        getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
      })

      expect(useTimelineStore.getState().items).toEqual([ITEM, SECOND_ITEM])
    },
  )

  it('rejects the fallback when there is no selected clip', () => {
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM, SECOND_ITEM], transitions: [] })
    usePlaybackStore.setState({ currentFrame: 55, previewFrame: 12, previewItemId: SECOND_ITEM.id })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    expect(useTimelineStore.getState().items).toEqual([ITEM, SECOND_ITEM])
  })

  it('rejects the fallback when multiple clips are selected', () => {
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM, SECOND_ITEM], transitions: [] })
    useSelectionStore.getState().selectItems([ITEM.id, SECOND_ITEM.id])
    usePlaybackStore.setState({ currentFrame: 25, previewFrame: 12, previewItemId: ITEM.id })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    expect(useTimelineStore.getState().items).toEqual([ITEM, SECOND_ITEM])
  })

  it('rejects a selected fallback whose item is missing', () => {
    useSelectionStore.getState().selectItems(['missing-item'])
    usePlaybackStore.setState({ currentFrame: 20, previewFrame: 12, previewItemId: ITEM.id })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    expect(useTimelineStore.getState().items).toEqual([ITEM])
  })

  it('keeps Shift+C owned by the persistent Razor tool', () => {
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('RAZOR_TOOL').callback({ preventDefault: vi.fn() })
    })

    expect(useSelectionStore.getState().activeTool).toBe('razor')
    expect(useTimelineStore.getState().items).toEqual([ITEM])
  })

  it('does not split while microphone recording is active', () => {
    setTimelineHover(ITEM.id, 25)
    useMicRecordingStore.setState({ status: 'recording' })
    render(<ShortcutHarness />)

    act(() => {
      getRegistration('SPLIT_AT_PLAYHEAD').callback({ preventDefault: vi.fn() })
    })

    expect(useTimelineStore.getState().items).toEqual([ITEM])
  })
})
