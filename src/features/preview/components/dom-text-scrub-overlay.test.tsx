import React, { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import type { PlayerRef } from '@/features/preview/deps/player-core'
import { DomTextScrubOverlay } from './dom-text-scrub-overlay'

const seekToMock = vi.fn<(frame: number) => void>()

vi.mock('@/features/preview/deps/player-core', async () => {
  const React = await import('react')
  const HeadlessPlayer = React.forwardRef<
    { seekTo: (frame: number) => void },
    React.PropsWithChildren
  >(({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ seekTo: seekToMock }), [])
    return <div>{children}</div>
  })
  HeadlessPlayer.displayName = 'HeadlessPlayer'
  return { HeadlessPlayer }
})

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: () => null,
}))

describe('DomTextScrubOverlay', () => {
  let rafId = 0
  let rafCallbacks = new Map<number, FrameRequestCallback>()

  const flushAnimationFrames = () => {
    const callbacks = [...rafCallbacks.values()]
    rafCallbacks.clear()
    for (const callback of callbacks) callback(performance.now())
  }

  beforeEach(() => {
    seekToMock.mockReset()
    rafId = 0
    rafCallbacks = new Map()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++rafId
      rafCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id)
    })
    usePlaybackStore.setState({
      currentFrame: 10,
      currentFrameEpoch: 1,
      previewFrame: 10,
      previewFrameEpoch: 1,
      frameUpdateEpoch: 1,
      isPlaying: false,
    })
    usePreviewBridgeStore.setState({ displayedFrame: 10 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('waits for the displayed canvas frame before advancing scrub text', () => {
    render(
      <DomTextScrubOverlay
        playerRef={createRef<PlayerRef>()}
        visible
        durationInFrames={120}
        fps={30}
        renderSize={{ width: 1920, height: 1080 }}
        layoutSize={{ width: 1280, height: 720 }}
        inputProps={{
          fps: 30,
          width: 1920,
          height: 1080,
          tracks: [],
          transitions: [],
          keyframes: [],
        }}
      />,
    )

    act(flushAnimationFrames)
    expect(seekToMock).toHaveBeenLastCalledWith(10)
    seekToMock.mockClear()

    act(() => {
      usePlaybackStore.getState().setScrubFrame(20)
      flushAnimationFrames()
    })
    expect(seekToMock).not.toHaveBeenCalled()

    act(() => {
      usePreviewBridgeStore.getState().setDisplayedFrame(20)
      flushAnimationFrames()
    })
    expect(seekToMock).toHaveBeenCalledOnce()
    expect(seekToMock).toHaveBeenLastCalledWith(20)
  })

  it('composites the rendered preview and DOM text into one canvas when the API is available', () => {
    const drawImage = vi.fn()
    const drawElementImage = vi.fn(() => ({ toString: () => 'matrix(1, 0, 0, 1, 0, 0)' }))
    const context = {
      canvas: { width: 1920, height: 1080 },
      reset: vi.fn(),
      clearRect: vi.fn(),
      drawImage,
      drawElementImage,
    } as unknown as CanvasRenderingContext2D
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as never)
    const requestPaint = vi.fn()
    Object.defineProperty(HTMLCanvasElement.prototype, 'layoutSubtree', {
      configurable: true,
      writable: true,
      value: false,
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'requestPaint', {
      configurable: true,
      writable: true,
      value: requestPaint,
    })

    try {
      const backgroundCanvas = document.createElement('canvas')
      backgroundCanvas.width = 1928
      backgroundCanvas.height = 1088

      const { container } = render(
        <DomTextScrubOverlay
          playerRef={createRef<PlayerRef>()}
          visible
          durationInFrames={120}
          fps={30}
          renderSize={{ width: 1920, height: 1080 }}
          layoutSize={{ width: 1280, height: 720 }}
          inputProps={{
            fps: 30,
            width: 1920,
            height: 1080,
            tracks: [],
            transitions: [],
            keyframes: [],
          }}
          backgroundCanvasRef={{ current: backgroundCanvas }}
          htmlInCanvasEnabled
        />,
      )

      const hybridCanvas = container.querySelector(
        'canvas[data-html-in-canvas-preview="active"]',
      ) as (HTMLCanvasElement & { onpaint?: (event: Event) => void }) | null
      expect(hybridCanvas).not.toBeNull()
      expect(hybridCanvas).toHaveAttribute('layoutsubtree')
      expect(hybridCanvas?.width).toBe(1920)
      expect(hybridCanvas?.height).toBe(1080)
      expect(hybridCanvas).toHaveStyle({ visibility: 'visible', opacity: '1' })
      expect(requestPaint).toHaveBeenCalled()
      expect(typeof hybridCanvas?.onpaint).toBe('function')

      act(() => hybridCanvas?.onpaint?.(new Event('paint')))

      expect(drawImage).toHaveBeenCalledWith(
        backgroundCanvas,
        4,
        4,
        1920,
        1080,
        0,
        0,
        1920,
        1080,
      )
      expect(drawElementImage).toHaveBeenCalledOnce()
      expect(window.__FREECUT_HTML_IN_CANVAS_PREVIEW__?.snapshot()).toMatchObject({
        supported: true,
        active: true,
        paints: 1,
      })
      expect(hybridCanvas).toHaveAttribute('data-html-in-canvas-paints', '1')
    } finally {
      getContext.mockRestore()
      delete (HTMLCanvasElement.prototype as HTMLCanvasElement & { layoutSubtree?: boolean })
        .layoutSubtree
      delete (HTMLCanvasElement.prototype as HTMLCanvasElement & { requestPaint?: () => void })
        .requestPaint
    }
  })
})
