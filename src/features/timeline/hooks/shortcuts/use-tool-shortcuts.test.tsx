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
