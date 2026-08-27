import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  HOTKEY_OPTIONS,
  HOTKEYS,
  getRuntimeHotkeyBinding,
  resolveHotkeys,
  type HotkeyBindingMap,
  type HotkeyKey,
} from '@/config/hotkeys'
import { useResolvedHotkeys, useSettingsStore } from '@/features/timeline/deps/settings'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../../stores/timeline-store'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { useEditingShortcuts } from './use-editing-shortcuts'
import { useInOutShortcuts } from './use-in-out-shortcuts'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

const runtimeHotkeysOverride = vi.hoisted(() => ({
  current: null as HotkeyBindingMap | null,
}))

function runtimePrimaryBindings(bindings: HotkeyBindingMap): HotkeyBindingMap {
  return Object.fromEntries(
    (Object.keys(HOTKEYS) as HotkeyKey[]).map((command) => [
      command,
      getRuntimeHotkeyBinding(bindings, command) ?? '',
    ]),
  ) as HotkeyBindingMap
}

const originalPlaybackActions = {
  togglePlayPause: usePlaybackStore.getState().togglePlayPause,
  shuttleForward: usePlaybackStore.getState().shuttleForward,
  shuttleReverse: usePlaybackStore.getState().shuttleReverse,
}

vi.mock('@/features/timeline/deps/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/timeline/deps/settings')>()
  return {
    ...actual,
    useResolvedHotkeys: () => runtimeHotkeysOverride.current ?? actual.useResolvedHotkeys(),
    useRuntimeHotkeys: () =>
      runtimePrimaryBindings(runtimeHotkeysOverride.current ?? actual.useResolvedHotkeys()),
  }
})

function RuntimeConflictHarness({ onJoin }: { onJoin: () => void }) {
  const hotkeys = useResolvedHotkeys()
  const joinBinding = getRuntimeHotkeyBinding(hotkeys, 'JOIN_ITEMS')
  usePlaybackShortcuts({})
  useInOutShortcuts()
  useHotkeys(joinBinding ?? [], onJoin, HOTKEY_OPTIONS, [onJoin, joinBinding])
  return null
}

function FullRuntimeConflictHarness() {
  usePlaybackShortcuts({})
  useEditingShortcuts({})
  useInOutShortcuts()
  return null
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
  durationInFrames: 100,
  label: 'Clip 1',
  src: 'clip.mp4',
}

describe('runtime shortcut ownership', () => {
  beforeEach(() => {
    runtimeHotkeysOverride.current = null
    useSettingsStore.getState().resetHotkeys()
    usePlaybackStore.setState({
      currentFrame: 48,
      previewFrame: 120,
      previewItemId: null,
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
      ...originalPlaybackActions,
    })
    useTimelineStore.setState({ inPoint: null, outPoint: null })
    useSelectionStore.setState({ selectedItemIds: [] })
  })

  it('executes only JOIN_ITEMS after rejecting the exact derived-chord swap', () => {
    useSettingsStore.getState().replaceHotkeyOverrides({
      MARK_IN: 'j',
      SHUTTLE_REVERSE: 'i',
    })
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({})
    const onJoin = vi.fn()
    render(<RuntimeConflictHarness onJoin={onJoin} />)

    fireEvent.keyDown(document, { key: 'J', code: 'KeyJ', shiftKey: true })

    expect(onJoin).toHaveBeenCalledTimes(1)
    expect(useTimelineStore.getState().inPoint).toBeNull()
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
  })

  it('keeps ordinary remaps distinct across capture and bubble handlers', () => {
    useSettingsStore.getState().replaceHotkeyOverrides({
      MARK_IN: 'q',
      SHUTTLE_REVERSE: 'g',
    })
    const onJoin = vi.fn()
    render(<RuntimeConflictHarness onJoin={onJoin} />)

    fireEvent.keyDown(document, { key: 'Q', code: 'KeyQ', shiftKey: true })
    expect(useTimelineStore.getState().inPoint).toBe(120)
    expect(onJoin).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'g', code: 'KeyG' })
    expect(usePlaybackStore.getState()).toMatchObject({
      isPlaying: true,
      playbackRate: -1,
      transportMode: 'shuttle',
    })

    fireEvent.keyDown(document, { key: 'J', code: 'KeyJ', shiftKey: true })
    expect(onJoin).toHaveBeenCalledTimes(1)
  })

  it('executes one deterministic handler for a legacy meta versus mod collision', () => {
    const legacyHotkeys = {
      ...resolveHotkeys(),
      MARK_IN: 'meta+j',
      JOIN_ITEMS: 'mod+shift+j',
    }
    runtimeHotkeysOverride.current = legacyHotkeys
    const onJoin = vi.fn()
    render(<RuntimeConflictHarness onJoin={onJoin} />)

    fireEvent.keyDown(document, { key: 'J', code: 'KeyJ', metaKey: true, shiftKey: true })

    expect(onJoin).toHaveBeenCalledTimes(1)
    expect(useTimelineStore.getState().inPoint).toBeNull()
  })

  it('gives PLAY_PAUSE sole ownership of a legacy meta versus mod transport collision', () => {
    runtimeHotkeysOverride.current = {
      ...resolveHotkeys(),
      PLAY_PAUSE: 'meta+f10',
      SHUTTLE_REVERSE: 'mod+f10',
    }
    const togglePlayPause = vi.fn(originalPlaybackActions.togglePlayPause)
    const shuttleReverse = vi.fn(originalPlaybackActions.shuttleReverse)
    usePlaybackStore.setState({ togglePlayPause, shuttleReverse })
    render(<FullRuntimeConflictHarness />)

    fireEvent.keyDown(document, { key: 'F10', code: 'F10', metaKey: true })

    expect(togglePlayPause).toHaveBeenCalledTimes(1)
    expect(shuttleReverse).not.toHaveBeenCalled()
  })

  it('gives playback sole ownership across playback and split shortcut hooks', () => {
    runtimeHotkeysOverride.current = {
      ...resolveHotkeys(),
      SHUTTLE_FORWARD: 'mod+f9',
      SPLIT_AT_PLAYHEAD_ALT: 'meta+f9',
    }
    usePlaybackStore.setState({ currentFrame: 50 })
    useTimelineStore.setState({ tracks: [TRACK], items: [ITEM] })
    const shuttleForward = vi.fn(originalPlaybackActions.shuttleForward)
    usePlaybackStore.setState({ shuttleForward })
    render(<FullRuntimeConflictHarness />)

    fireEvent.keyDown(document, { key: 'F9', code: 'F9', metaKey: true })

    expect(shuttleForward).toHaveBeenCalledTimes(1)
    expect(useTimelineStore.getState().items).toEqual([ITEM])
  })

  it('keeps physically distinct explicit meta and ctrl bindings reachable', () => {
    runtimeHotkeysOverride.current = {
      ...resolveHotkeys(),
      PLAY_PAUSE: 'meta+f8',
      SHUTTLE_REVERSE: 'ctrl+f8',
    }
    const togglePlayPause = vi.fn(originalPlaybackActions.togglePlayPause)
    const shuttleReverse = vi.fn(originalPlaybackActions.shuttleReverse)
    usePlaybackStore.setState({ togglePlayPause, shuttleReverse })
    render(<FullRuntimeConflictHarness />)

    fireEvent.keyDown(document, { key: 'F8', code: 'F8', metaKey: true })
    fireEvent.keyDown(document, { key: 'F8', code: 'F8', ctrlKey: true })

    expect(togglePlayPause).toHaveBeenCalledTimes(1)
    expect(shuttleReverse).toHaveBeenCalledTimes(1)
  })

  it('does not let a bubble registration duplicate a capture-owned event', () => {
    runtimeHotkeysOverride.current = {
      ...resolveHotkeys(),
      PLAY_PAUSE: 'meta+f7',
      CLEAR_IN_OUT: 'mod+f7',
    }
    useTimelineStore.setState({ inPoint: 10, outPoint: 20 })
    const togglePlayPause = vi.fn(originalPlaybackActions.togglePlayPause)
    usePlaybackStore.setState({ togglePlayPause })
    render(<FullRuntimeConflictHarness />)

    fireEvent.keyDown(document, { key: 'F7', code: 'F7', metaKey: true })

    expect(togglePlayPause).toHaveBeenCalledTimes(1)
    expect(useTimelineStore.getState()).toMatchObject({ inPoint: 10, outPoint: 20 })
  })

  it('filters only runtime ownership without rewriting raw bindings or labels', () => {
    const persistedOverrides = {
      PLAY_PAUSE: 'meta+f10',
      SHUTTLE_REVERSE: 'mod+f10',
    } as const
    const displayHotkeys = { ...resolveHotkeys(), ...persistedOverrides }
    runtimeHotkeysOverride.current = displayHotkeys
    const togglePlayPause = vi.fn(originalPlaybackActions.togglePlayPause)
    const shuttleReverse = vi.fn(originalPlaybackActions.shuttleReverse)
    usePlaybackStore.setState({ togglePlayPause, shuttleReverse })
    render(<FullRuntimeConflictHarness />)

    fireEvent.keyDown(document, { key: 'F10', code: 'F10', metaKey: true })

    expect(togglePlayPause).toHaveBeenCalledTimes(1)
    expect(shuttleReverse).not.toHaveBeenCalled()
    expect(persistedOverrides).toEqual({
      PLAY_PAUSE: 'meta+f10',
      SHUTTLE_REVERSE: 'mod+f10',
    })
    expect(displayHotkeys).toMatchObject(persistedOverrides)
  })
})
