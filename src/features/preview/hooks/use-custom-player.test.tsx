import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store'
import { ClockBridgeProvider, useClock } from '../deps/player'
import { useCustomPlayer } from './use-custom-player'

function createPlayer(initialFrame = 0) {
  const { result } = renderHook(() => useClock(), {
    wrapper: ({ children }) => (
      <ClockBridgeProvider fps={30} durationInFrames={900} initialFrame={initialFrame}>
        {children}
      </ClockBridgeProvider>
    ),
  })
  const clock = result.current
  return {
    clock,
    player: {
      seekTo: vi.fn((frame: number) => clock.seekToFrame(frame)),
      play: vi.fn(() => clock.play()),
      pause: vi.fn(() => clock.pause()),
      getCurrentFrame: () => clock.currentFrame,
      isPlaying: () => clock.isPlaying,
      setPlaybackRate: vi.fn((rate: number) => {
        clock.playbackRate = rate
      }),
    },
  }
}

beforeEach(() => {
  useTimelineSettingsStore.setState({ isTimelineLoading: false })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  usePlaybackStore.setState({ isPlaying: false })
  useEditorStore.setState({ hostMode: false })
})

describe('preview mount transport ownership', () => {
  it.each([true, false])('preserves host transport only when hostMode=%s', (hostMode) => {
    useEditorStore.setState({ hostMode })
    usePlaybackStore.setState({ isPlaying: true, currentFrame: 42 })
    const playerRef = {
      current: {
        seekTo: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        getCurrentFrame: () => 42,
        isPlaying: () => true,
        setPlaybackRate: vi.fn(),
      },
    }
    const first = renderHook(() => useCustomPlayer(playerRef))
    expect(usePlaybackStore.getState().isPlaying).toBe(hostMode)
    first.unmount()
    renderHook(() => useCustomPlayer(playerRef))
    expect(usePlaybackStore.getState().isPlaying).toBe(hostMode)
    expect(usePlaybackStore.getState().currentFrame).toBe(42)
  })
})

describe('preview Player transport reconciliation', () => {
  it('starts a fresh host Player at the preserved frame and advances its Clock', () => {
    vi.useFakeTimers()
    useEditorStore.setState({ hostMode: true })
    usePlaybackStore.setState({ isPlaying: true, currentFrame: 42 })
    const { player, clock } = createPlayer()
    renderHook(() => useCustomPlayer({ current: player }))
    expect(clock.isPlaying).toBe(true)
    expect(clock.currentFrame).toBe(42)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(clock.currentFrame).toBeGreaterThan(42)
    expect(player.play).toHaveBeenCalledTimes(1)
    act(() => {
      usePlaybackStore.getState().pause()
    })
    expect(clock.isPlaying).toBe(false)
  })

  it('reconciles a Player that becomes available after the former readiness timeout', () => {
    vi.useFakeTimers()
    useEditorStore.setState({ hostMode: true })
    usePlaybackStore.setState({ isPlaying: false, currentFrame: 42 })
    const { player, clock } = createPlayer()
    const playerRef: { current: typeof player | null } = { current: null }
    renderHook(() => useCustomPlayer(playerRef))
    act(() => {
      usePlaybackStore.setState({ isPlaying: true, currentFrame: 75 })
      vi.advanceTimersByTime(1500)
    })
    playerRef.current = player
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(clock.isPlaying).toBe(true)
    expect(clock.currentFrame).toBe(75)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('uses the latest paused transport when a late Player becomes ready', () => {
    vi.useFakeTimers()
    useEditorStore.setState({ hostMode: true })
    usePlaybackStore.setState({ isPlaying: true, currentFrame: 42 })
    const { player, clock } = createPlayer()
    const playerRef: { current: typeof player | null } = { current: null }
    renderHook(() => useCustomPlayer(playerRef))
    act(() => {
      usePlaybackStore.setState({ isPlaying: false, currentFrame: 75 })
    })
    clock.play()
    playerRef.current = player
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(clock.isPlaying).toBe(false)
    expect(clock.currentFrame).toBe(75)
    expect(player.play).not.toHaveBeenCalled()
    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  it('keeps a fresh standalone Player paused without starting it during mount', () => {
    usePlaybackStore.setState({ isPlaying: true, currentFrame: 42 })
    const { player, clock } = createPlayer()
    renderHook(() => useCustomPlayer({ current: player }))
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(clock.isPlaying).toBe(false)
    expect(clock.currentFrame).toBe(42)
    expect(player.play).not.toHaveBeenCalled()
  })

  it('does not replay a Player already following host transport', () => {
    useEditorStore.setState({ hostMode: true })
    usePlaybackStore.setState({ isPlaying: true, currentFrame: 42 })
    const { player, clock } = createPlayer(42)
    clock.play()
    renderHook(() => useCustomPlayer({ current: player }))
    expect(player.play).not.toHaveBeenCalled()
    expect(clock.isPlaying).toBe(true)
  })
})
