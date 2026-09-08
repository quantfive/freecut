import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useCustomPlayer } from './use-custom-player'

afterEach(() => {
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
