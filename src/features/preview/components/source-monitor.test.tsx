import { StrictMode, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, fireEvent, render, waitFor } from '@testing-library/react'

const sourceBindingState = vi.hoisted(() => ({
  globalVersion: 0,
  epochs: new Map<string, number>(),
  resolveMediaUrl: vi.fn<(mediaId: string) => Promise<string>>(),
  compositionMounts: 0,
  compositionUnmounts: 0,
  listeners: new Set<() => void>(),
  publish: () => {
    for (const listener of sourceBindingState.listeners) listener()
  },
}))

const editorStoreState = vi.hoisted(() => ({
  sourcePreviewMediaId: 'media-1' as string | null,
}))

const sourcePlayerStoreState = vi.hoisted(() => ({
  hoveredPanel: null as string | null,
  playerMethods: null as unknown,
  currentMediaId: null as string | null,
  currentSourceFrame: 0,
  previewSourceFrame: null as number | null,
  inPoint: null as number | null,
  outPoint: null as number | null,
  pendingSeekFrame: null as number | null,
  setHoveredPanel: vi.fn(),
  setPlayerMethods: vi.fn(),
  setCurrentMediaId: vi.fn(),
  releaseCurrentMediaId: vi.fn(),
  setCurrentSourceFrame: vi.fn(),
  setPreviewSourceFrame: vi.fn(),
  setInPoint: vi.fn(),
  setOutPoint: vi.fn(),
  clearInOutPoints: vi.fn(),
  setPendingSeekFrame: vi.fn(),
}))

const mediaStoreState = vi.hoisted(() => {
  const media1 = {
    id: 'media-1',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    audioCodec: 'aac',
  }
  return {
    mediaItems: [media1],
    mediaById: { 'media-1': media1 } as Record<string, typeof media1>,
  }
})

const itemsStoreState = vi.hoisted(() => ({
  tracks: [],
}))

const playerMethodsState = vi.hoisted(() => ({
  seek: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  toggle: vi.fn(),
  frameBack: vi.fn(),
  frameForward: vi.fn(),
  isPlaying: vi.fn(() => false),
  setPlaybackRate: vi.fn(),
}))

const clockState = vi.hoisted(() => ({
  currentFrame: 0,
  isPlaying: false,
  playbackRate: 1,
}))

const resolvedHotkeysState = vi.hoisted(() => ({
  hotkeys: {
    MARK_IN: 'i',
    MARK_OUT: 'o',
    CLEAR_IN_OUT: 'alt+x',
    GO_TO_START: 'home',
    PREVIOUS_FRAME: 'left',
    PLAY_PAUSE: 'space',
    NEXT_FRAME: 'right',
    GO_TO_END: 'end',
    INSERT_EDIT: 'comma',
    OVERWRITE_EDIT: 'period',
  },
}))

const runtimeHotkeysState = vi.hoisted(() => ({
  hotkeys: { ...resolvedHotkeysState.hotkeys },
}))

vi.mock('@/hooks/use-runtime-hotkey-binding', () => ({
  useRuntimeHotkeyBinding: (command: keyof typeof runtimeHotkeysState.hotkeys) =>
    runtimeHotkeysState.hotkeys[command] ?? '',
}))

vi.mock('@/features/preview/deps/player-context', () => ({
  PlayerEmitterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClockBridgeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VideoConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClock: () => ({
    currentFrame: clockState.currentFrame,
    isPlaying: clockState.isPlaying,
    onFrameChange: () => () => {},
  }),
  useClockIsPlaying: () => clockState.isPlaying,
  useClockPlaybackRate: () => clockState.playbackRate,
  usePlayer: () => playerMethodsState,
}))

vi.mock('./source-composition', () => ({
  SourceComposition: ({ src }: { src: string }) => {
    useEffect(() => {
      sourceBindingState.compositionMounts += 1
      return () => {
        sourceBindingState.compositionUnmounts += 1
      }
    }, [])
    return <div data-testid="source-composition" data-source={src} />
  },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}))

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: sourceBindingState.resolveMediaUrl,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  useBlobUrlVersion: () =>
    useSyncExternalStore(
      (listener) => {
        sourceBindingState.listeners.add(listener)
        return () => sourceBindingState.listeners.delete(listener)
      },
      () => sourceBindingState.globalVersion,
    ),
  useBlobUrlEpoch: (mediaId: string) =>
    useSyncExternalStore(
      (listener) => {
        sourceBindingState.listeners.add(listener)
        return () => sourceBindingState.listeners.delete(listener)
      },
      () => String(sourceBindingState.epochs.get(mediaId) ?? 0),
    ),
}))

vi.mock('@/features/preview/deps/media-library', () => {
  const useMediaLibraryStore = Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    { getState: () => mediaStoreState },
  )

  return {
    useMediaLibraryStore,
    getMediaType: (mimeType: string) => {
      if (mimeType.startsWith('video/')) return 'video'
      if (mimeType.startsWith('audio/')) return 'audio'
      if (mimeType.startsWith('image/')) return 'image'
      return 'unknown'
    },
  }
})

vi.mock('@/features/preview/deps/timeline-store', () => {
  const useItemsStore = Object.assign(
    (selector: (state: typeof itemsStoreState) => unknown) => selector(itemsStoreState),
    { getState: () => itemsStoreState },
  )

  return { useItemsStore }
})

vi.mock('@/features/preview/deps/settings', () => {
  const settingsState = { editorDensity: 'compact' as const }
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  )

  return {
    useSettingsStore,
    useResolvedHotkeys: () => resolvedHotkeysState.hotkeys,
    useRuntimeHotkeys: () => runtimeHotkeysState.hotkeys,
  }
})

vi.mock('@/shared/state/editor', () => {
  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    { getState: () => editorStoreState },
  )

  return { useEditorStore }
})

vi.mock('@/shared/state/source-player', () => {
  const useSourcePlayerStore = Object.assign(
    (selector: (state: typeof sourcePlayerStoreState) => unknown) =>
      selector(sourcePlayerStoreState),
    { getState: () => sourcePlayerStoreState },
  )

  return { useSourcePlayerStore }
})

vi.mock('@/shared/state/selection', () => {
  const selectionState = { activeTrackId: null as string | null }
  const useSelectionStore = Object.assign(
    (selector: (state: typeof selectionState) => unknown) => selector(selectionState),
    { getState: () => selectionState },
  )

  return { useSelectionStore }
})

vi.mock('@/features/preview/deps/timeline-source-edit', () => ({
  getTrackKind: (track: { kind?: string | null }) => track.kind ?? null,
  performInsertEdit: vi.fn(),
  performOverwriteEdit: vi.fn(),
  resolveSourceEditTrackTargets: vi.fn(() => null),
}))

import { SourceMonitor } from './source-monitor'

describe('SourceMonitor current media ownership', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle)
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sourcePlayerStoreState.previewSourceFrame = null
    sourcePlayerStoreState.inPoint = null
    sourcePlayerStoreState.outPoint = null
    sourcePlayerStoreState.setPreviewSourceFrame.mockImplementation((frame: number | null) => {
      sourcePlayerStoreState.previewSourceFrame = frame
    })
    sourcePlayerStoreState.setInPoint.mockImplementation((frame: number | null) => {
      sourcePlayerStoreState.inPoint = frame
    })
    sourcePlayerStoreState.setOutPoint.mockImplementation((frame: number | null) => {
      sourcePlayerStoreState.outPoint = frame
    })
    sourceBindingState.globalVersion = 0
    sourceBindingState.epochs.clear()
    sourceBindingState.resolveMediaUrl.mockResolvedValue('blob:media-1')
    sourceBindingState.compositionMounts = 0
    sourceBindingState.compositionUnmounts = 0
    sourceBindingState.listeners.clear()
    editorStoreState.sourcePreviewMediaId = 'media-1'
    clockState.currentFrame = 0
    clockState.isPlaying = false
    resolvedHotkeysState.hotkeys = {
      MARK_IN: 'i',
      MARK_OUT: 'o',
      CLEAR_IN_OUT: 'alt+x',
      GO_TO_START: 'home',
      PREVIOUS_FRAME: 'left',
      PLAY_PAUSE: 'space',
      NEXT_FRAME: 'right',
      GO_TO_END: 'end',
      INSERT_EDIT: 'comma',
      OVERWRITE_EDIT: 'period',
    }
    runtimeHotkeysState.hotkeys = { ...resolvedHotkeysState.hotkeys }
  })

  it('updates visible shortcut labels after remap and reset', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => expect(rendered.getByLabelText('Mark In (I)')).toBeInTheDocument())

    resolvedHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      MARK_IN: 'shift+f',
    }
    runtimeHotkeysState.hotkeys = { ...resolvedHotkeysState.hotkeys }
    rendered.rerender(<SourceMonitor key="remapped" mediaId="media-1" />)
    expect(rendered.getByLabelText('Mark In (Shift + F)')).toBeInTheDocument()

    resolvedHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      MARK_IN: 'i',
    }
    rendered.rerender(<SourceMonitor key="reset" mediaId="media-1" />)
    expect(rendered.getByLabelText('Mark In (I)')).toBeInTheDocument()
  })

  it('keeps the raw local label while a losing runtime binding is disabled', async () => {
    resolvedHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      MARK_IN: 'meta+f10',
    }
    runtimeHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      MARK_IN: '',
    }
    sourcePlayerStoreState.currentSourceFrame = 42
    const rendered = render(<SourceMonitor mediaId="media-1" />)
    await waitFor(() => expect(rendered.getByLabelText(/Mark In \(.+f10\)/i)).toBeInTheDocument())

    fireEvent.keyDown(rendered.container.firstElementChild!, {
      key: 'F10',
      code: 'F10',
      metaKey: true,
    })

    expect(sourcePlayerStoreState.setInPoint).not.toHaveBeenCalled()
    expect(resolvedHotkeysState.hotkeys.MARK_IN).toBe('meta+f10')
  })

  it('uses the same reactive binding for local source-monitor actions', async () => {
    resolvedHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      MARK_IN: 'shift+f',
    }
    runtimeHotkeysState.hotkeys = { ...resolvedHotkeysState.hotkeys }
    sourcePlayerStoreState.currentSourceFrame = 42
    const rendered = render(<SourceMonitor mediaId="media-1" />)
    await waitFor(() => expect(rendered.getByLabelText('Mark In (Shift + F)')).toBeInTheDocument())
    const monitor = rendered.container.firstElementChild!

    fireEvent.keyDown(monitor, { key: 'i', code: 'KeyI' })
    expect(sourcePlayerStoreState.setInPoint).not.toHaveBeenCalled()

    fireEvent.keyDown(monitor, { key: 'F', code: 'KeyF', shiftKey: true })
    expect(sourcePlayerStoreState.setInPoint).toHaveBeenCalledWith(42)
  })

  it('uses macOS modifier names in visible shortcut labels', async () => {
    const originalPlatform = navigator.platform
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    resolvedHotkeysState.hotkeys = {
      ...resolvedHotkeysState.hotkeys,
      CLEAR_IN_OUT: 'alt+x',
    }

    try {
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      await waitFor(() =>
        expect(rendered.getByLabelText('Clear In/Out (Option + X)')).toBeInTheDocument(),
      )
    } finally {
      Object.defineProperty(navigator, 'platform', { configurable: true, value: originalPlatform })
    }
  })

  it('does not release the current media during the initial Strict Mode remount', async () => {
    render(
      <StrictMode>
        <SourceMonitor mediaId="media-1" />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    expect(sourcePlayerStoreState.releaseCurrentMediaId).not.toHaveBeenCalled()
  })

  it('releases the current media once the source monitor closes', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    editorStoreState.sourcePreviewMediaId = null
    rendered.unmount()

    expect(sourcePlayerStoreState.releaseCurrentMediaId).toHaveBeenCalledWith('media-1')
  })

  it('batches seek bar drags and commits the final frame on mouseup', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    const seekBar = rendered.getByTestId('source-monitor-seek-bar')
    vi.spyOn(seekBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(seekBar, { clientX: 25 })
    fireEvent.mouseMove(document, { clientX: 75 })

    expect(playerMethodsState.seek).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentSourceFrame).toHaveBeenLastCalledWith(112)
    })

    fireEvent.mouseUp(document)

    expect(playerMethodsState.seek).toHaveBeenCalledTimes(1)
    expect(playerMethodsState.seek).toHaveBeenCalledWith(112)
  })

  it('freezes the last visible source scrub on owner hide before late movement and release', async () => {
    const rendered = render(
      <div data-editor-workspace-shell="" data-testid="owner">
        <SourceMonitor mediaId="media-1" />
      </div>,
    )
    const bar = await rendered.findByTestId('source-monitor-seek-bar')
    const owner = rendered.getByTestId('owner')
    const bounds = vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })
    fireEvent.mouseDown(bar, { clientX: 25 })
    expect(sourcePlayerStoreState.setPreviewSourceFrame).toHaveBeenLastCalledWith(37)
    // Queue a new pointer position without letting its RAF become visible.
    fireEvent.mouseMove(document, { clientX: 75 })
    act(() => {
      owner.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
      owner.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
    })
    owner.style.display = 'none'
    bounds.mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    })
    fireEvent.mouseMove(document, { clientX: 90 })
    fireEvent.mouseUp(document)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(sourcePlayerStoreState.setPreviewSourceFrame).toHaveBeenLastCalledWith(37)
    expect(playerMethodsState.seek).not.toHaveBeenCalled()
    expect(playerMethodsState.play).not.toHaveBeenCalled()
    expect(sourceBindingState.compositionUnmounts).toBe(0)
    owner.style.display = ''
    fireEvent.click(rendered.getByRole('button', { name: 'Play (Space)' }))
    expect(playerMethodsState.seek).toHaveBeenLastCalledWith(37)
    expect(playerMethodsState.play).toHaveBeenCalledTimes(1)
    expect(sourcePlayerStoreState.previewSourceFrame).toBeNull()
  })

  it.each(['in-handle', 'out-handle', 'range'])(
    'cancels owned I/O %s capture and retains applied range/preview',
    async (kind) => {
      sourcePlayerStoreState.inPoint = 30
      sourcePlayerStoreState.outPoint = 120
      const rendered = render(
        <div data-editor-workspace-shell="" data-testid="owner">
          <SourceMonitor mediaId="media-1" />
        </div>,
      )
      const control = await rendered.findByTestId(`source-monitor-io-${kind}`)
      const owner = rendered.getByTestId('owner')
      const strip =
        kind === 'range' ? control.parentElement! : control.parentElement!.parentElement!
      const hitTarget = kind === 'range' ? control : control.nextElementSibling!
      const bounds = vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 10,
        width: 100,
        height: 10,
        toJSON: () => ({}),
      })
      fireEvent.pointerDown(hitTarget, { button: 0, pointerId: 1, clientX: 40 })
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 50 })
      const held = sourcePlayerStoreState.previewSourceFrame
      expect(held).toBeGreaterThan(0)
      const applied = [sourcePlayerStoreState.inPoint, sourcePlayerStoreState.outPoint]
      const foreign = document.createElement('div')
      document.body.append(foreign)
      act(() =>
        foreign.dispatchEvent(
          new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }),
        ),
      )
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 55 })
      expect(sourcePlayerStoreState.previewSourceFrame).not.toBe(held)
      const finalPreview = sourcePlayerStoreState.previewSourceFrame
      const finalRange = [sourcePlayerStoreState.inPoint, sourcePlayerStoreState.outPoint]
      expect(finalRange).not.toEqual(applied)
      act(() => {
        owner.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
        owner.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
      })
      owner.style.display = 'none'
      bounds.mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      })
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0 })
      fireEvent.pointerUp(document, { pointerId: 1 })
      expect([sourcePlayerStoreState.inPoint, sourcePlayerStoreState.outPoint]).toEqual(finalRange)
      expect(sourcePlayerStoreState.previewSourceFrame).toBe(finalPreview)
      expect(playerMethodsState.seek).not.toHaveBeenCalled()
      expect(playerMethodsState.play).not.toHaveBeenCalled()
      owner.style.display = ''
      fireEvent.click(rendered.getByRole('button', { name: 'Play (Space)' }))
      expect(playerMethodsState.seek).toHaveBeenLastCalledWith(finalPreview)
      expect(playerMethodsState.play).toHaveBeenCalledTimes(1)
      expect(sourcePlayerStoreState.previewSourceFrame).toBeNull()
      foreign.remove()
    },
  )

  it('ignores cancellation from another shell while a normal scrub commits on release', async () => {
    const rendered = render(
      <div data-editor-workspace-shell="">
        <SourceMonitor mediaId="media-1" />
      </div>,
    )
    const bar = await rendered.findByTestId('source-monitor-seek-bar')
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })
    const foreign = document.createElement('div')
    foreign.setAttribute('data-editor-workspace-shell', '')
    document.body.append(foreign)
    fireEvent.mouseDown(bar, { clientX: 25 })
    act(() =>
      foreign.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true })),
    )
    fireEvent.mouseMove(document, { clientX: 75 })
    fireEvent.mouseUp(document)
    expect(playerMethodsState.seek).toHaveBeenCalledExactlyOnceWith(112)
    expect(sourcePlayerStoreState.previewSourceFrame).toBeNull()
    foreign.remove()
  })

  it.each(['in-handle', 'out-handle', 'range'])(
    'normal I/O %s release retains range and ends preview',
    async (kind) => {
      sourcePlayerStoreState.inPoint = 30
      sourcePlayerStoreState.outPoint = 120
      const rendered = render(<SourceMonitor mediaId="media-1" />)
      const control = await rendered.findByTestId(`source-monitor-io-${kind}`)
      const strip =
        kind === 'range' ? control.parentElement! : control.parentElement!.parentElement!
      const target = kind === 'range' ? control : control.nextElementSibling!
      vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 10,
        width: 100,
        height: 10,
        toJSON: () => ({}),
      })
      fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 40 })
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 50 })
      const applied = [sourcePlayerStoreState.inPoint, sourcePlayerStoreState.outPoint]
      expect(applied).not.toEqual([30, 120])
      fireEvent.pointerUp(document, { pointerId: 1 })
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 0 })
      expect([sourcePlayerStoreState.inPoint, sourcePlayerStoreState.outPoint]).toEqual(applied)
      expect(sourcePlayerStoreState.previewSourceFrame).toBeNull()
    },
  )

  it('pauses playback when seek-bar scrubbing starts', async () => {
    clockState.isPlaying = true
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1')
    })

    const seekBar = rendered.getByTestId('source-monitor-seek-bar')
    vi.spyOn(seekBar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(seekBar, { clientX: 25 })

    expect(playerMethodsState.pause).toHaveBeenCalledTimes(1)
  })

  it('keeps the current source generation mounted across unrelated blob URL activity', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(rendered.getByTestId('source-composition')).toHaveAttribute(
        'data-source',
        'blob:media-1',
      )
    })
    expect(sourceBindingState.resolveMediaUrl).toHaveBeenCalledTimes(1)
    expect(sourceBindingState.compositionMounts).toBe(1)

    act(() => {
      sourceBindingState.globalVersion += 1
      sourceBindingState.publish()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(sourceBindingState.resolveMediaUrl).toHaveBeenCalledTimes(1)
    expect(sourceBindingState.compositionMounts).toBe(1)
    expect(sourceBindingState.compositionUnmounts).toBe(0)
    expect(rendered.getByTestId('source-composition')).toHaveAttribute(
      'data-source',
      'blob:media-1',
    )
  })

  it('retires and resolves a relevant source epoch exactly once', async () => {
    let resolveReplacement!: (url: string) => void
    const replacement = new Promise<string>((resolve) => {
      resolveReplacement = resolve
    })
    sourceBindingState.resolveMediaUrl
      .mockResolvedValueOnce('blob:old')
      .mockReturnValueOnce(replacement)
    const rendered = render(<SourceMonitor mediaId="media-1" />)

    await waitFor(() => {
      expect(rendered.getByTestId('source-composition')).toHaveAttribute('data-source', 'blob:old')
    })

    act(() => {
      sourceBindingState.epochs.set('media-1', 1)
      sourceBindingState.globalVersion += 1
      sourceBindingState.publish()
    })

    expect(rendered.queryByTestId('source-composition')).toBeNull()
    await waitFor(() => expect(sourceBindingState.resolveMediaUrl).toHaveBeenCalledTimes(2))
    expect(sourceBindingState.compositionUnmounts).toBe(1)

    await act(async () => {
      resolveReplacement('blob:new')
      await replacement
    })

    expect(rendered.getByTestId('source-composition')).toHaveAttribute('data-source', 'blob:new')
    expect(sourceBindingState.resolveMediaUrl).toHaveBeenCalledTimes(2)
  })
})
