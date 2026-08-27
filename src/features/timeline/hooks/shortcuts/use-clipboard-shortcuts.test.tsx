import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEYS } from '@/config/hotkeys'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useSelectionStore } from '@/shared/state/selection'
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useClipboardShortcuts } from './use-clipboard-shortcuts'

const { addItemsMock, playbackState, useHotkeysMock } = vi.hoisted(() => ({
  addItemsMock: vi.fn(),
  playbackState: {
    currentFrame: 200,
    setCurrentFrame: vi.fn(),
    setBusAudioEq: vi.fn(),
    setMasterBusDb: vi.fn(),
  },
  useHotkeysMock: vi.fn(),
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: useHotkeysMock,
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => playbackState,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('../../stores/timeline-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/timeline-actions')>()
  return {
    ...actual,
    addItems: addItemsMock,
  }
})

const TARGET_TRACK: TimelineTrack = {
  id: 'target-track',
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

const AUDIO_TRACK: TimelineTrack = {
  ...TARGET_TRACK,
  id: 'target-audio',
  name: 'A1',
  kind: 'audio',
  order: 1,
}

const SECOND_VIDEO_TRACK: TimelineTrack = {
  ...TARGET_TRACK,
  id: 'target-video-2',
  name: 'V2',
  order: 1,
}
const SECOND_AUDIO_TRACK: TimelineTrack = {
  ...AUDIO_TRACK,
  id: 'target-audio-2',
  name: 'A2',
  order: 3,
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: TARGET_TRACK.id,
    from: 0,
    durationInFrames: 10,
    label: 'Clip',
    src: 'clip.mp4',
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: AUDIO_TRACK.id,
    from: 0,
    durationInFrames: 10,
    label: 'Audio',
    src: 'clip.mp4',
    ...overrides,
  }
}

function makeCaptionItem(overrides: Partial<TextItem> = {}): TextItem {
  return {
    id: 'caption-1',
    type: 'text',
    trackId: 'missing-caption-track',
    from: 0,
    durationInFrames: 10,
    label: 'Caption',
    text: 'Caption',
    color: '#fff',
    textRole: 'caption',
    ...overrides,
  }
}

function ShortcutHarness() {
  useClipboardShortcuts()
  return null
}

type HotkeyCallback = (event: { preventDefault: () => void }) => void

function getPasteCallback(): HotkeyCallback {
  const registration = useHotkeysMock.mock.calls.find(([keys]) => keys === HOTKEYS.PASTE)
  expect(registration).toBeDefined()
  return registration?.[1] as HotkeyCallback
}

function getPlannedItems(): TimelineItem[] {
  expect(addItemsMock).toHaveBeenCalledTimes(1)
  return addItemsMock.mock.calls[0]?.[0] as TimelineItem[]
}

describe('useClipboardShortcuts paste placement', () => {
  beforeEach(() => {
    addItemsMock.mockClear()
    useHotkeysMock.mockClear()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)

    useTimelineStore.setState({
      tracks: [TARGET_TRACK],
      items: [],
      transitions: [],
      keyframes: [],
      markers: [],
    })
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedItemIdSet: new Set(),
      selectedTransitionId: null,
      activeTrackId: TARGET_TRACK.id,
    })
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [],
      clipboard: null,
      isCut: false,
    })
    useCompositionNavigationStore.setState({ activeCompositionId: null })
    useClipboardStore.setState({ itemsClipboard: null, transitionClipboard: null })
    playbackState.currentFrame = 200
    useTimelineCommandStore.getState().clearHistory()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('anchors the earliest copied item at the playhead and preserves relative offsets', () => {
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'early', label: 'Early', from: 40 }),
          makeVideoItem({ id: 'late', label: 'Late', from: 70 }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    expect(getPlannedItems().map((item) => ({ label: item.label, from: item.from }))).toEqual([
      { label: 'Early', from: 200 },
      { label: 'Late', from: 230 },
    ])
  })

  it('checks already-planned pasted items when source tracks map to one target track', () => {
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'first', label: 'First', trackId: 'missing-v1', from: 40 }),
          makeVideoItem({ id: 'second', label: 'Second', trackId: 'missing-v1', from: 45 }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const plannedItems = getPlannedItems()
    expect(plannedItems.map((item) => item.trackId)).toEqual([TARGET_TRACK.id, TARGET_TRACK.id])
    expect(plannedItems.map((item) => item.from)).toEqual([200, 210])
    expect(plannedItems[0]!.from + plannedItems[0]!.durationInFrames).toBeLessThanOrEqual(
      plannedItems[1]!.from,
    )
  })

  it('moves a linked video/audio pair together when one target track collides', () => {
    useTimelineStore.setState({
      tracks: [TARGET_TRACK, AUDIO_TRACK],
      items: [makeVideoItem({ id: 'occupied', from: 200 })],
    })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'video', from: 40, linkedGroupId: 'linked-source' }),
          makeAudioItem({ id: 'audio', from: 40, linkedGroupId: 'linked-source' }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const plannedItems = getPlannedItems()
    expect(plannedItems.map((item) => item.from)).toEqual([210, 210])
    expect(plannedItems[0]!.linkedGroupId).toBeTruthy()
    expect(plannedItems[1]!.linkedGroupId).toBe(plannedItems[0]!.linkedGroupId)
  })

  it('maps linked A/V items with absent source IDs to separate compatible lanes', () => {
    useTimelineStore.setState({ tracks: [TARGET_TRACK, AUDIO_TRACK] })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'missing-video', trackId: 'source-v', linkedGroupId: 'pair' }),
          makeAudioItem({ id: 'missing-audio', trackId: 'source-a', linkedGroupId: 'pair' }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    expect(getPlannedItems().map((item) => item.trackId)).toEqual([TARGET_TRACK.id, AUDIO_TRACK.id])
  })

  it('preserves lane ordinals for multiple linked pairs and keeps captions on video lanes', () => {
    useTimelineStore.setState({
      tracks: [TARGET_TRACK, SECOND_VIDEO_TRACK, AUDIO_TRACK, SECOND_AUDIO_TRACK],
    })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'v1', trackId: 'source-v1', linkedGroupId: 'pair-1' }),
          makeAudioItem({ id: 'a1', trackId: 'source-a1', linkedGroupId: 'pair-1' }),
          makeVideoItem({ id: 'v2', trackId: 'source-v2', from: 20, linkedGroupId: 'pair-2' }),
          makeAudioItem({ id: 'a2', trackId: 'source-a2', from: 20, linkedGroupId: 'pair-2' }),
          makeCaptionItem({ id: 'caption', trackId: 'source-v2', from: 20 }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const plannedItems = getPlannedItems()
    expect(plannedItems.map((item) => item.trackId)).toEqual([
      TARGET_TRACK.id,
      AUDIO_TRACK.id,
      SECOND_VIDEO_TRACK.id,
      SECOND_AUDIO_TRACK.id,
      SECOND_VIDEO_TRACK.id,
    ])
    expect(plannedItems.filter((item) => item.type === 'text')[0]?.trackId).toBe(
      SECOND_VIDEO_TRACK.id,
    )
  })

  it('uses surviving IDs while resolving missing linked members by kind', () => {
    useTimelineStore.setState({ tracks: [TARGET_TRACK, AUDIO_TRACK] })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'surviving-video', trackId: TARGET_TRACK.id, linkedGroupId: 'pair' }),
          makeAudioItem({ id: 'missing-audio', trackId: 'source-a', linkedGroupId: 'pair' }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    expect(getPlannedItems().map((item) => item.trackId)).toEqual([TARGET_TRACK.id, AUDIO_TRACK.id])
  })

  it('keeps source ordinals separate when malformed A/V lanes reuse an id', () => {
    useTimelineStore.setState({
      tracks: [TARGET_TRACK, AUDIO_TRACK, SECOND_AUDIO_TRACK],
    })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'shared-video', trackId: 'shared-missing', linkedGroupId: 'pair' }),
          makeAudioItem({ id: 'shared-audio', trackId: 'shared-missing', linkedGroupId: 'pair' }),
          makeAudioItem({ id: 'second-audio', trackId: 'second-missing', from: 20 }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    expect(getPlannedItems().map((item) => item.trackId)).toEqual([
      TARGET_TRACK.id,
      AUDIO_TRACK.id,
      SECOND_AUDIO_TRACK.id,
    ])
  })

  it('reserves a later surviving lane before assigning an earlier missing source', () => {
    useTimelineStore.setState({ tracks: [TARGET_TRACK] })
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'missing-first', label: 'Missing', trackId: 'missing-video' }),
          makeVideoItem({ id: 'surviving-second', label: 'Surviving', trackId: TARGET_TRACK.id }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const pastedItems = useTimelineStore.getState().items
    expect(pastedItems.find((item) => item.label === 'Surviving')?.trackId).toBe(TARGET_TRACK.id)
    expect(new Set(pastedItems.map((item) => item.trackId)).size).toBe(2)
    expect(useTimelineStore.getState().tracks).toHaveLength(2)
  })

  it('splits malformed overlapping members of one linked group safely', () => {
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'overlap-1', trackId: 'same-source', linkedGroupId: 'bad-group' }),
          makeVideoItem({ id: 'overlap-2', trackId: 'same-source', linkedGroupId: 'bad-group' }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const plannedItems = getPlannedItems()
    expect(plannedItems.map((item) => item.from)).toEqual([200, 210])
    expect(plannedItems[0]!.from + plannedItems[0]!.durationInFrames).toBeLessThanOrEqual(
      plannedItems[1]!.from,
    )
  })

  it('creates deterministic compatible lanes and undoes tracks and items together', () => {
    useClipboardStore
      .getState()
      .copyItems(
        [
          makeVideoItem({ id: 'lane-1', trackId: 'missing-v1', from: 0 }),
          makeVideoItem({ id: 'lane-2', trackId: 'missing-v2', from: 0 }),
        ],
        0,
        'copy',
      )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    expect(useTimelineStore.getState().tracks.map((track) => track.kind)).toEqual([
      'video',
      'video',
    ])
    expect(useTimelineStore.getState().items).toHaveLength(2)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    act(() => useTimelineCommandStore.getState().undo())
    expect(useTimelineStore.getState().tracks).toHaveLength(1)
    expect(useTimelineStore.getState().tracks[0]?.id).toBe(TARGET_TRACK.id)
    expect(useTimelineStore.getState().items).toEqual([])
  })

  it('creates and atomically undoes a missing linked audio lane after a video collision', () => {
    useTimelineStore.setState({
      tracks: [TARGET_TRACK],
      items: [makeVideoItem({ id: 'occupied-video', from: 200 })],
    })
    useClipboardStore.getState().copyItems(
      [
        makeVideoItem({
          id: 'linked-video',
          trackId: 'missing-video',
          linkedGroupId: 'source-pair',
        }),
        makeAudioItem({
          id: 'linked-audio',
          trackId: 'missing-audio',
          linkedGroupId: 'source-pair',
        }),
      ],
      0,
      'copy',
    )

    render(<ShortcutHarness />)
    act(() => getPasteCallback()({ preventDefault: vi.fn() }))

    const pasted = useTimelineStore.getState().items.filter((item) => item.id !== 'occupied-video')
    expect(pasted).toHaveLength(2)
    expect(pasted.map((item) => item.from)).toEqual([210, 210])
    expect(pasted[0]!.linkedGroupId).toBeTruthy()
    expect(pasted[1]!.linkedGroupId).toBe(pasted[0]!.linkedGroupId)
    expect(useTimelineStore.getState().tracks.map((track) => track.kind)).toEqual([
      'video',
      'audio',
    ])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    act(() => useTimelineCommandStore.getState().undo())
    expect(useTimelineStore.getState().tracks).toHaveLength(1)
    expect(useTimelineStore.getState().tracks[0]).toMatchObject({
      id: TARGET_TRACK.id,
      kind: 'video',
    })
    expect(useTimelineStore.getState().items.map((item) => item.id)).toEqual(['occupied-video'])
  })
})
