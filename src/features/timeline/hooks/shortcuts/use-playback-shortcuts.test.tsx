import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import type { SourcePlayerMethods } from '@/shared/state/source-player/types'
import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '../../stores/items-store'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

function PlaybackShortcutHarness() {
  usePlaybackShortcuts({})
  return <input aria-label="Editable title" />
}

function sourcePlayerMethods(durationInFrames = 300): SourcePlayerMethods {
  return {
    toggle: vi.fn(),
    pause: vi.fn(),
    isPlaying: vi.fn(() => true),
    shuttleForward: vi.fn(),
    shuttleReverse: vi.fn(),
    seek: vi.fn(),
    frameBack: vi.fn(),
    frameForward: vi.fn(),
    getDurationInFrames: vi.fn(() => durationInFrames),
  }
}

function videoItem(overrides: Partial<VideoItem> = {}): VideoItem {
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

describe('usePlaybackShortcuts transport routing', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetHotkeys()
    usePlaybackStore.setState({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
    })
    useSourcePlayerStore.setState({
      hoveredPanel: null,
      playerMethods: null,
    })
    useItemsStore
      .getState()
      .setItems([videoItem(), videoItem({ id: 'clip-2', from: 0, durationInFrames: 7 })])
  })

  it('routes J, K, and L to reverse, pause, and forward program transport', () => {
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'l', code: 'KeyL' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: true,
      playbackRate: 1,
      transportMode: 'shuttle',
    })

    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
    })

    fireEvent.keyDown(document, { key: 'j', code: 'KeyJ' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: true,
      playbackRate: -1,
      transportMode: 'shuttle',
    })
  })

  it('claims K as pause even when program transport is already paused', () => {
    render(<PlaybackShortcutHarness />)

    expect(fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })).toBe(false)
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
  })

  it('routes J, K, and L to the source monitor while it is hovered', () => {
    const playerMethods = sourcePlayerMethods()
    useSourcePlayerStore.setState({ hoveredPanel: 'source', playerMethods })
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'j', code: 'KeyJ' })
    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })
    fireEvent.keyDown(document, { key: 'l', code: 'KeyL' })

    expect(playerMethods.shuttleReverse).toHaveBeenCalledTimes(1)
    expect(playerMethods.pause).toHaveBeenCalledTimes(1)
    expect(playerMethods.shuttleForward).toHaveBeenCalledTimes(1)
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
  })

  it('protects editable fields from transport shortcuts', () => {
    render(<PlaybackShortcutHarness />)
    const input = screen.getByRole('textbox', { name: 'Editable title' })

    fireEvent.keyDown(input, { key: 'j', code: 'KeyJ' })
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK' })
    fireEvent.keyDown(input, { key: 'l', code: 'KeyL' })

    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
    })
  })

  it('routes customized transport bindings instead of the defaults', () => {
    useSettingsStore.getState().replaceHotkeyOverrides({
      SHUTTLE_REVERSE: 'q',
      SHUTTLE_PAUSE: 'w',
      SHUTTLE_FORWARD: 'e',
    })
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'l', code: 'KeyL' })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)

    fireEvent.keyDown(document, { key: 'e', code: 'KeyE' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: true,
      playbackRate: 1,
      transportMode: 'shuttle',
    })

    fireEvent.keyDown(document, { key: 'w', code: 'KeyW' })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)

    fireEvent.keyDown(document, { key: 'q', code: 'KeyQ' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: true,
      playbackRate: -1,
      transportMode: 'shuttle',
    })
  })

  it('clamps timeline ArrowRight to the final valid frame', () => {
    usePlaybackStore.setState({ currentFrame: 13 })
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(usePlaybackStore.getState().currentFrame).toBe(14)

    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(usePlaybackStore.getState().currentFrame).toBe(14)
  })

  it('seeks timeline End to the maximum inclusive item frame, or zero when empty', () => {
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'End', code: 'End' })
    expect(usePlaybackStore.getState().currentFrame).toBe(14)

    useItemsStore.getState().setItems([])
    fireEvent.keyDown(document, { key: 'End', code: 'End' })
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
  })

  it('clamps source-player End to a nonnegative frame', () => {
    const playerMethods = sourcePlayerMethods(0)
    useSourcePlayerStore.setState({ hoveredPanel: 'source', playerMethods })
    render(<PlaybackShortcutHarness />)

    fireEvent.keyDown(document, { key: 'End', code: 'End' })

    expect(playerMethods.seek).toHaveBeenCalledWith(0)
  })
})
