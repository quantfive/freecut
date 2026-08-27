// @vitest-environment jsdom

import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { useSettingsStore } from '@/features/editor/deps/settings'
import { useHostTimelineShortcuts } from '@/features/editor/deps/timeline-hooks'
import { usePlaybackStore } from '@/shared/state/playback'
import { createHostShortcutSettings, type EditorHost, type HostShortcutSettings } from './contract'
import { mountHostShortcutSettings } from './shortcut-settings'

function HostShortcutHarness() {
  useHostTimelineShortcuts()
  return null
}

function createShortcutHost(initial: HostShortcutSettings) {
  const listeners = new Set<(settings: HostShortcutSettings) => void>()
  const setSettings = vi.fn()
  const notify = vi.fn()
  const host: EditorHost = {
    capabilities: {},
    load: vi.fn(() => {
      throw new Error('not used')
    }),
    resolveMedia: vi.fn(() => null),
    submitEdit: vi.fn(() => {
      throw new Error('not used')
    }),
    shortcuts: {
      getSettings: vi.fn(() => initial),
      setSettings,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    notify,
  }

  return {
    host,
    setSettings,
    notify,
    emit: (settings: HostShortcutSettings) => {
      for (const listener of listeners) listener(settings)
    },
  }
}

describe('host shortcut settings round trip', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetHotkeys()
    usePlaybackStore.setState({
      isPlaying: false,
      playbackRate: 1,
      transportMode: 'normal',
    })
  })

  it('hydrates host bindings, persists UI changes, and accepts agent updates', async () => {
    useSettingsStore.getState().replaceHotkeyOverrides({ PLAY_PAUSE: 'shift+space' })
    const harness = createShortcutHost(
      createHostShortcutSettings({
        SHUTTLE_REVERSE: 'q',
        SHUTTLE_PAUSE: 'w',
        SHUTTLE_FORWARD: 'e',
      }),
    )

    const unmount = await mountHostShortcutSettings(harness.host)

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      SHUTTLE_REVERSE: 'q',
      SHUTTLE_PAUSE: 'w',
      SHUTTLE_FORWARD: 'e',
    })

    render(createElement(HostShortcutHarness))
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

    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')

    await waitFor(() =>
      expect(harness.setSettings).toHaveBeenLastCalledWith(
        createHostShortcutSettings({
          SHUTTLE_REVERSE: 'q',
          SHUTTLE_PAUSE: 'x',
          SHUTTLE_FORWARD: 'e',
        }),
      ),
    )

    harness.emit(
      createHostShortcutSettings({
        SHUTTLE_REVERSE: 'a',
        SHUTTLE_PAUSE: 's',
        SHUTTLE_FORWARD: 'd',
      }),
    )

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      SHUTTLE_REVERSE: 'a',
      SHUTTLE_PAUSE: 's',
      SHUTTLE_FORWARD: 'd',
    })
    expect(harness.notify).not.toHaveBeenCalled()

    unmount()
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      PLAY_PAUSE: 'shift+space',
    })
  })
})
