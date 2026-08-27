// @vitest-environment jsdom

import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/editor/deps/settings'
import { useSettingsStore } from '@/features/editor/deps/settings'
import { useHostTimelineShortcuts } from '@/features/editor/deps/timeline-hooks'
import { usePlaybackStore } from '@/shared/state/playback'
import { createHostShortcutSettings, type EditorHost, type HostShortcutSettings } from './contract'
import { mountHostShortcutSettings } from './shortcut-settings'

function HostShortcutHarness() {
  useHostTimelineShortcuts()
  return null
}

function ConflictingShortcutHarness({ onAddKeyframe }: { onAddKeyframe: () => void }) {
  const hotkeys = useResolvedHotkeys()
  useHotkeys(hotkeys.EDIT_KEYFRAME_ADD, onAddKeyframe, HOTKEY_OPTIONS, [onAddKeyframe])
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
    listenerCount: () => listeners.size,
    emit: (settings: HostShortcutSettings) => {
      for (const listener of listeners) listener(settings)
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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
        SHUTTLE_REVERSE: 'q',
        SHUTTLE_PAUSE: 'w',
        SHUTTLE_FORWARD: 'e',
      }),
    )

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      SHUTTLE_REVERSE: 'q',
      SHUTTLE_PAUSE: 'w',
      SHUTTLE_FORWARD: 'e',
    })
    expect(harness.notify).not.toHaveBeenCalled()

    unmount()
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      PLAY_PAUSE: 'shift+space',
    })
  })

  it('keeps late hydration from host A inert after host B replaces it', async () => {
    let resolveA!: (settings: HostShortcutSettings) => void
    const hostA = createShortcutHost(createHostShortcutSettings({ SHUTTLE_REVERSE: 'a' }))
    hostA.host.shortcuts!.getSettings = vi.fn(
      () => new Promise<HostShortcutSettings>((resolve) => (resolveA = resolve)),
    )
    const mountA = mountHostShortcutSettings(hostA.host)

    const hostB = createShortcutHost(createHostShortcutSettings({ SHUTTLE_REVERSE: 'b' }))
    const unmountB = await mountHostShortcutSettings(hostB.host)
    resolveA(createHostShortcutSettings({ SHUTTLE_REVERSE: 'a' }))
    const unmountA = await mountA

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ SHUTTLE_REVERSE: 'b' })
    expect(hostA.listenerCount()).toBe(0)
    unmountA()
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ SHUTTLE_REVERSE: 'b' })
    unmountB()
  })

  it('invalidates deferred host A when replacement B omits the optional shortcut port', async () => {
    useSettingsStore.getState().replaceHotkeyOverrides({ PLAY_PAUSE: 'shift+space' })
    let resolveA!: (settings: HostShortcutSettings) => void
    const hostA = createShortcutHost(createHostShortcutSettings({ SHUTTLE_REVERSE: 'a' }))
    hostA.host.shortcuts!.getSettings = vi.fn(
      () => new Promise<HostShortcutSettings>((resolve) => (resolveA = resolve)),
    )
    const mountA = mountHostShortcutSettings(hostA.host)
    const hostB = { ...createShortcutHost(createHostShortcutSettings({})).host }
    delete hostB.shortcuts

    const unmountB = await mountHostShortcutSettings(hostB)
    resolveA(createHostShortcutSettings({ SHUTTLE_REVERSE: 'a' }))
    const unmountA = await mountA

    expect(hostA.listenerCount()).toBe(0)
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      PLAY_PAUSE: 'shift+space',
    })
    unmountA()
    unmountB()
  })

  it('cancels deferred hydration on unmount before subscribing', async () => {
    useSettingsStore.getState().replaceHotkeyOverrides({ PLAY_PAUSE: 'shift+space' })
    let resolveSettings!: (settings: HostShortcutSettings) => void
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_REVERSE: 'q' }))
    host.host.shortcuts!.getSettings = vi.fn(
      () => new Promise<HostShortcutSettings>((resolve) => (resolveSettings = resolve)),
    )
    const controller = new AbortController()
    const mounting = mountHostShortcutSettings(host.host, controller.signal)

    controller.abort()
    resolveSettings(createHostShortcutSettings({ SHUTTLE_REVERSE: 'q' }))
    const unmount = await mounting

    expect(host.listenerCount()).toBe(0)
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({
      PLAY_PAUSE: 'shift+space',
    })
    unmount()
  })

  it('does not execute a queued write after its host is disposed', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const unmount = await mountHostShortcutSettings(host.host)
    const pending = Promise.resolve()
    host.setSettings.mockReturnValueOnce(pending)
    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    unmount()
    await Promise.resolve()
    expect(host.setSettings).not.toHaveBeenCalled()
  })

  it('drops an older outbound write when newer host input arrives', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const unmount = await mountHostShortcutSettings(host.host)
    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    host.emit(createHostShortcutSettings({ SHUTTLE_PAUSE: 'w' }))
    await Promise.resolve()
    expect(host.setSettings).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ SHUTTLE_PAUSE: 'w' })
    unmount()
  })

  it('reconciles newer subscribed state after an older write finishes last', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const firstWrite = createDeferred<void>()
    host.setSettings.mockReturnValueOnce(firstWrite.promise)
    const unmount = await mountHostShortcutSettings(host.host)

    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    await waitFor(() => expect(host.setSettings).toHaveBeenCalledTimes(1))

    host.emit(createHostShortcutSettings({ SHUTTLE_PAUSE: 'w' }))
    firstWrite.resolve()

    await waitFor(() =>
      expect(host.setSettings).toHaveBeenLastCalledWith(
        createHostShortcutSettings({ SHUTTLE_PAUSE: 'w' }),
      ),
    )
    expect(host.setSettings).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('retries the newest subscribed state after an older write rejects', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const firstWrite = createDeferred<void>()
    host.setSettings.mockReturnValueOnce(firstWrite.promise)
    const unmount = await mountHostShortcutSettings(host.host)

    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    await waitFor(() => expect(host.setSettings).toHaveBeenCalledTimes(1))
    host.emit(createHostShortcutSettings({ SHUTTLE_PAUSE: 'w' }))
    firstWrite.reject(new Error('old write failed'))

    await waitFor(() =>
      expect(host.setSettings).toHaveBeenLastCalledWith(
        createHostShortcutSettings({ SHUTTLE_PAUSE: 'w' }),
      ),
    )
    expect(host.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('save') }),
    )
    unmount()
  })

  it('fences in-flight host A work when host B replaces it', async () => {
    const hostA = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'a' }))
    const firstWrite = createDeferred<void>()
    hostA.setSettings.mockReturnValueOnce(firstWrite.promise)
    const unmountA = await mountHostShortcutSettings(hostA.host)
    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    await waitFor(() => expect(hostA.setSettings).toHaveBeenCalledTimes(1))

    const hostB = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'b' }))
    const unmountB = await mountHostShortcutSettings(hostB.host)
    expect(hostA.listenerCount()).toBe(0)
    expect(hostB.listenerCount()).toBe(1)

    hostA.emit(createHostShortcutSettings({ SHUTTLE_PAUSE: 'z' }))
    firstWrite.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(hostA.setSettings).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ SHUTTLE_PAUSE: 'b' })
    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'y')
    await waitFor(() => expect(hostB.setSettings).toHaveBeenCalledTimes(1))

    unmountA()
    expect(hostB.listenerCount()).toBe(1)
    unmountB()
    expect(hostB.listenerCount()).toBe(0)
  })

  it('suppresses equal subscription echoes without a redundant write loop', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const write = createDeferred<void>()
    host.setSettings.mockReturnValueOnce(write.promise)
    const unmount = await mountHostShortcutSettings(host.host)

    useSettingsStore.getState().setHotkeyBinding('SHUTTLE_PAUSE', 'x')
    await waitFor(() => expect(host.setSettings).toHaveBeenCalledTimes(1))
    host.emit(createHostShortcutSettings({ SHUTTLE_PAUSE: 'x' }))
    write.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(host.setSettings).toHaveBeenCalledTimes(1)
    expect(host.listenerCount()).toBe(1)
    unmount()
    expect(host.listenerCount()).toBe(0)
  })

  it('removes the host subscriber on unmount', async () => {
    const host = createShortcutHost(createHostShortcutSettings({ SHUTTLE_PAUSE: 'p' }))
    const unmount = await mountHostShortcutSettings(host.host)
    expect(host.listenerCount()).toBe(1)
    unmount()
    expect(host.listenerCount()).toBe(0)
  })

  it('resolves a host collision so capture and bubbling listeners fire one intended action', async () => {
    const harness = createShortcutHost(
      createHostShortcutSettings({
        SHUTTLE_PAUSE: 'k',
        EDIT_KEYFRAME_ADD: 'k',
      }),
    )
    const unmount = await mountHostShortcutSettings(harness.host)
    const addKeyframe = vi.fn()

    render(createElement(ConflictingShortcutHarness, { onAddKeyframe: addKeyframe }))
    usePlaybackStore.setState({ isPlaying: true })
    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(addKeyframe).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'K', code: 'KeyK', shiftKey: true })
    expect(addKeyframe).toHaveBeenCalledTimes(1)
    expect(harness.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conflict' }))

    unmount()
  })

  it('retains the last valid settings and reports derived host conflict metadata', async () => {
    useSettingsStore.getState().replaceHotkeyOverrides({ PLAY_PAUSE: 'shift+space' })
    const harness = createShortcutHost(
      createHostShortcutSettings({
        MARK_IN: 'j',
        SHUTTLE_REVERSE: 'i',
      }),
    )

    const unmount = await mountHostShortcutSettings(harness.host)

    expect(useSettingsStore.getState().hotkeyOverrides).toEqual({ PLAY_PAUSE: 'shift+space' })
    expect(harness.notify).toHaveBeenCalledWith({
      kind: 'conflict',
      message: expect.stringMatching(/shift\+j.*MARK_IN.*JOIN_ITEMS.*last valid/i),
    })
    expect(harness.setSettings).not.toHaveBeenCalled()
    unmount()
  })
})
