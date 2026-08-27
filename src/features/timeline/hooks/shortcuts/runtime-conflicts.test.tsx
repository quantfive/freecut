import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useResolvedHotkeys, useSettingsStore } from '@/features/timeline/deps/settings'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '../../stores/timeline-store'
import { useInOutShortcuts } from './use-in-out-shortcuts'
import { usePlaybackShortcuts } from './use-playback-shortcuts'

function RuntimeConflictHarness({ onJoin }: { onJoin: () => void }) {
  const hotkeys = useResolvedHotkeys()
  usePlaybackShortcuts({})
  useInOutShortcuts()
  useHotkeys(hotkeys.JOIN_ITEMS, onJoin, HOTKEY_OPTIONS, [onJoin, hotkeys.JOIN_ITEMS])
  return null
}

describe('runtime shortcut ownership', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetHotkeys()
    usePlaybackStore.setState({
      currentFrame: 48,
      previewFrame: 120,
      previewItemId: null,
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
    })
    useTimelineStore.setState({ inPoint: null, outPoint: null })
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
})
