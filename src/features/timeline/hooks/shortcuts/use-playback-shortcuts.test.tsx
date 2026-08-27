import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEYS } from '@/config/hotkeys'
import type { SourcePlayerMethods } from '@/shared/state/source-player/types'
import type { VideoItem } from '@/types/timeline'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

const { itemsState, playbackState, sourcePlayerState, useHotkeysMock } = vi.hoisted(() => {
  const playbackState = {
    currentFrame: 0,
    isPlaying: false,
    togglePlayPause: vi.fn(),
    shuttleForward: vi.fn(),
    shuttleReverse: vi.fn(),
    pause: vi.fn(),
    setCurrentFrame: vi.fn((frame: number) => {
      playbackState.currentFrame = frame
    }),
    setPreviewFrame: vi.fn(),
  }

  return {
    itemsState: { items: [] as Array<{ from: number; durationInFrames: number }> },
    playbackState,
    sourcePlayerState: {
      hoveredPanel: null as 'source' | null,
      playerMethods: null as SourcePlayerMethods | null,
    },
    useHotkeysMock: vi.fn(),
  }
})

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: useHotkeysMock,
}))

vi.mock('@/features/timeline/deps/settings', () => ({
  useResolvedHotkeys: () => ({
    PLAY_PAUSE: 'space',
    PREVIOUS_FRAME: 'left',
    NEXT_FRAME: 'right',
    GO_TO_START: 'home',
    GO_TO_END: 'end',
    NEXT_SNAP_POINT: 'down',
    PREVIOUS_SNAP_POINT: 'up',
  }),
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  ),
}))

vi.mock('@/shared/state/preview-bridge', () => ({
  usePreviewBridgeStore: (selector: (state: { setDisplayedFrame: () => void }) => unknown) =>
    selector({ setDisplayedFrame: vi.fn() }),
}))

vi.mock('@/shared/state/source-player', () => ({
  useSourcePlayerStore: {
    getState: () => sourcePlayerState,
  },
}))

vi.mock('../../stores/items-store', () => ({
  useItemsStore: {
    getState: () => itemsState,
  },
}))

type HotkeyCallback = (event: { preventDefault: () => void }) => void

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 10,
    durationInFrames: 5,
    label: 'Clip',
    src: 'clip.mp4',
    ...overrides,
  }
}

function ShortcutHarness() {
  usePlaybackShortcuts({})
  return null
}

function getHotkeyCallback(binding: string): HotkeyCallback {
  const registration = useHotkeysMock.mock.calls.find(([keys]) => keys === binding)
  expect(registration).toBeDefined()
  return registration?.[1] as HotkeyCallback
}

function trigger(callback: HotkeyCallback) {
  act(() => callback({ preventDefault: vi.fn() }))
}

describe('usePlaybackShortcuts frame boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playbackState.currentFrame = 0
    playbackState.isPlaying = false
    itemsState.items = [
      makeVideoItem(),
      makeVideoItem({ id: 'clip-2', from: 0, durationInFrames: 7 }),
    ]
    sourcePlayerState.hoveredPanel = null
    sourcePlayerState.playerMethods = null
  })

  it('clamps timeline ArrowRight to the final valid frame', () => {
    playbackState.currentFrame = 13
    render(<ShortcutHarness />)

    const nextFrame = getHotkeyCallback(HOTKEYS.NEXT_FRAME)
    trigger(nextFrame)
    expect(playbackState.currentFrame).toBe(14)

    trigger(nextFrame)
    expect(playbackState.currentFrame).toBe(14)
  })

  it('seeks timeline End to the maximum inclusive item frame, or zero when empty', () => {
    render(<ShortcutHarness />)

    const goToEnd = getHotkeyCallback(HOTKEYS.GO_TO_END)
    trigger(goToEnd)
    expect(playbackState.currentFrame).toBe(14)

    itemsState.items = []
    trigger(goToEnd)
    expect(playbackState.currentFrame).toBe(0)
  })

  it('clamps source-player End to a nonnegative frame', () => {
    const playerMethods: SourcePlayerMethods = {
      toggle: vi.fn(),
      pause: vi.fn(),
      isPlaying: vi.fn(() => false),
      shuttleForward: vi.fn(),
      shuttleReverse: vi.fn(),
      seek: vi.fn(),
      frameBack: vi.fn(),
      frameForward: vi.fn(),
      getDurationInFrames: vi.fn(() => 0),
    }
    sourcePlayerState.hoveredPanel = 'source'
    sourcePlayerState.playerMethods = playerMethods
    render(<ShortcutHarness />)

    trigger(getHotkeyCallback(HOTKEYS.GO_TO_END))

    expect(playerMethods.seek).toHaveBeenCalledWith(0)
  })
})
