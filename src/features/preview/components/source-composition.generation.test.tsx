import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const decoderHarness = vi.hoisted(() => ({
  extractors: new Map<
    string,
    {
      init: ReturnType<typeof vi.fn>
      drawFrame: ReturnType<typeof vi.fn>
      getDimensions: ReturnType<typeof vi.fn>
      getDuration: ReturnType<typeof vi.fn>
      getLastFailureKind: ReturnType<typeof vi.fn>
    }
  >(),
  waitForInflightPredecodedBitmap: vi.fn(),
  createImageBitmap: vi.fn(),
}))

const clockHarness = vi.hoisted(() => ({
  clock: {
    currentFrame: 0,
    onFrameChange: vi.fn(() => () => {}),
  },
}))

vi.mock('@/features/preview/deps/player-core', () => ({
  AbsoluteFill: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/features/preview/deps/player-context', () => ({
  useClock: () => clockHarness.clock,
  useClockIsPlaying: () => false,
  useClockPlaybackRate: () => 1,
  usePlayer: () => ({ seek: vi.fn() }),
  useVideoConfig: () => ({ fps: 30, durationInFrames: 30 }),
}))

vi.mock('@/features/preview/deps/player-pool', () => ({
  getGlobalVideoSourcePool: () => ({
    preloadSource: vi.fn(async () => {}),
    acquireForClip: vi.fn(() => null),
    releaseClip: vi.fn(),
    seekClip: vi.fn(),
  }),
}))

vi.mock('@/features/preview/deps/export', () => ({
  SharedVideoExtractorPool: class SharedVideoExtractorPool {
    getOrCreateItemExtractor(_itemId: string, src: string) {
      const extractor = decoderHarness.extractors.get(src)
      if (!extractor) throw new Error(`Missing extractor for ${src}`)
      return extractor
    }

    releaseItem() {}
  },
}))

vi.mock('../utils/media-resolver', () => ({ resolveProxyUrl: () => null }))
vi.mock('../utils/decoder-prewarm', () => ({
  backgroundBatchPreseek: vi.fn(async () => {}),
  getCachedPredecodedBitmap: vi.fn(() => null),
  waitForInflightPredecodedBitmap: decoderHarness.waitForInflightPredecodedBitmap,
}))
vi.mock('../utils/fast-scrub-prewarm', () => ({ getDirectionalPrewarmOffsets: () => [] }))
vi.mock('../utils/source-media-sync', () => ({ shouldSeekPlayingMedia: () => false }))
vi.mock('./source-audio-waveform', () => ({ SourceAudioWaveform: () => null }))
vi.mock('@/infrastructure/lottie/lottie-frame-provider', () => ({ LottieRenderer: class {} }))

vi.mock('@/shared/state/playback', () => {
  const state = { useProxy: false }
  const usePlaybackStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return { usePlaybackStore }
})

vi.mock('@/shared/state/source-player', () => {
  const state = {
    currentSourceFrame: 0,
    previewSourceFrame: null as number | null,
    setCurrentSourceFrame: vi.fn(),
  }
  const useSourcePlayerStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      subscribe: () => () => {},
    },
  )
  return { useSourcePlayerStore }
})

vi.mock('@/features/preview/deps/media-library', () => ({
  useMediaLibraryStore: (selector: (state: { proxyStatus: Map<string, string> }) => unknown) =>
    selector({ proxyStatus: new Map() }),
}))

import { SourceComposition } from './source-composition'

type MockCanvasContext = CanvasRenderingContext2D & {
  clearRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
}

const canvasContexts = new WeakMap<HTMLCanvasElement, MockCanvasContext>()

function getCanvasContext(canvas: HTMLCanvasElement): MockCanvasContext {
  const existing = canvasContexts.get(canvas)
  if (existing) return existing
  const context = {
    canvas,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as MockCanvasContext
  canvasContexts.set(canvas, context)
  return context
}

function makeExtractor(init: Promise<boolean> = Promise.resolve(true)) {
  return {
    init: vi.fn(() => init),
    drawFrame: vi.fn(async () => true),
    getDimensions: vi.fn(() => ({ width: 4, height: 4 })),
    getDuration: vi.fn(() => 1),
    getLastFailureKind: vi.fn(() => null),
  }
}

async function flushDeferredWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('SourceComposition source generations', () => {
  beforeEach(() => {
    decoderHarness.extractors.clear()
    decoderHarness.waitForInflightPredecodedBitmap.mockReset()
    decoderHarness.waitForInflightPredecodedBitmap.mockResolvedValue(null)
    decoderHarness.createImageBitmap.mockReset()
    decoderHarness.createImageBitmap.mockResolvedValue({ close: vi.fn() })
    vi.stubGlobal('createImageBitmap', decoderHarness.createImageBitmap)
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    ;(
      getContextSpy as unknown as {
        mockImplementation: (
          implementation: (
            this: HTMLCanvasElement,
            contextId: string,
          ) => CanvasRenderingContext2D | null,
        ) => void
      }
    ).mockImplementation(function (this: HTMLCanvasElement, contextId) {
      return contextId === '2d' ? getCanvasContext(this) : null
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps a deferred old extractor draw off the visible canvas after a same-id src change', async () => {
    const oldDraw = deferred<boolean>()
    const oldExtractor = makeExtractor()
    oldExtractor.drawFrame.mockReturnValue(oldDraw.promise)
    decoderHarness.extractors.set('blob:old', oldExtractor)
    decoderHarness.extractors.set('blob:new', makeExtractor(Promise.resolve(false)))

    const rendered = render(
      <SourceComposition mediaId="same-media" src="blob:old" mediaType="video" />,
    )
    await waitFor(() => expect(oldExtractor.drawFrame).toHaveBeenCalledOnce())
    const visibleCanvas = rendered.container.querySelector('canvas')!
    const visibleContext = getCanvasContext(visibleCanvas)
    visibleContext.clearRect.mockClear()
    visibleContext.drawImage.mockClear()

    rendered.rerender(<SourceComposition mediaId="same-media" src="blob:new" mediaType="video" />)
    expect(visibleContext.clearRect).toHaveBeenCalled()

    oldDraw.resolve(true)
    await flushDeferredWork()

    expect(visibleContext.drawImage).not.toHaveBeenCalled()
    expect(visibleCanvas.style.display).toBe('none')
    expect(decoderHarness.createImageBitmap).not.toHaveBeenCalled()
  })

  it('hands the decode pump to the replacement generation after an old draw drains', async () => {
    const oldDraw = deferred<boolean>()
    const oldExtractor = makeExtractor()
    oldExtractor.drawFrame.mockReturnValue(oldDraw.promise)
    const newExtractor = makeExtractor()
    decoderHarness.extractors.set('blob:old', oldExtractor)
    decoderHarness.extractors.set('blob:new', newExtractor)

    const rendered = render(
      <SourceComposition mediaId="same-media" src="blob:old" mediaType="video" />,
    )
    await waitFor(() => expect(oldExtractor.drawFrame).toHaveBeenCalledOnce())
    const visibleCanvas = rendered.container.querySelector('canvas')!
    const visibleContext = getCanvasContext(visibleCanvas)
    visibleContext.drawImage.mockClear()

    rendered.rerender(<SourceComposition mediaId="same-media" src="blob:new" mediaType="video" />)
    await waitFor(() => expect(newExtractor.init).toHaveBeenCalledOnce())
    expect(newExtractor.drawFrame).not.toHaveBeenCalled()

    oldDraw.resolve(true)
    await flushDeferredWork()

    await waitFor(() => expect(newExtractor.drawFrame).toHaveBeenCalled())
    await waitFor(() => expect(visibleCanvas.style.display).toBe('block'))
    expect(visibleContext.drawImage).toHaveBeenCalled()
    expect(decoderHarness.createImageBitmap).toHaveBeenCalled()
  })

  it('closes a stale bitmap completion without marking the replacement decoded', async () => {
    const staleBitmap = { close: vi.fn() }
    const bitmapCompletion = deferred<typeof staleBitmap>()
    decoderHarness.createImageBitmap.mockReturnValueOnce(bitmapCompletion.promise)
    decoderHarness.extractors.set('blob:old', makeExtractor())
    decoderHarness.extractors.set('blob:new', makeExtractor(Promise.resolve(false)))

    const rendered = render(
      <SourceComposition mediaId="same-media" src="blob:old" mediaType="video" />,
    )
    await waitFor(() => expect(decoderHarness.createImageBitmap).toHaveBeenCalledOnce())
    const visibleCanvas = rendered.container.querySelector('canvas')!
    const visibleContext = getCanvasContext(visibleCanvas)
    const drawCountBeforeReset = visibleContext.drawImage.mock.calls.length

    rendered.rerender(<SourceComposition mediaId="same-media" src="blob:new" mediaType="video" />)
    bitmapCompletion.resolve(staleBitmap)
    await flushDeferredWork()

    expect(staleBitmap.close).toHaveBeenCalledOnce()
    expect(visibleContext.drawImage).toHaveBeenCalledTimes(drawCountBeforeReset)
    expect(visibleCanvas.style.display).toBe('none')
  })

  it('ignores an in-flight shared-cache completion from the old source', async () => {
    const sharedCompletion = deferred<{ close: ReturnType<typeof vi.fn> } | null>()
    decoderHarness.waitForInflightPredecodedBitmap.mockReturnValueOnce(sharedCompletion.promise)
    const oldExtractor = makeExtractor()
    decoderHarness.extractors.set('blob:old', oldExtractor)
    decoderHarness.extractors.set('blob:new', makeExtractor(Promise.resolve(false)))

    const rendered = render(
      <SourceComposition mediaId="same-media" src="blob:old" mediaType="video" />,
    )
    await waitFor(() =>
      expect(decoderHarness.waitForInflightPredecodedBitmap).toHaveBeenCalledOnce(),
    )
    const visibleCanvas = rendered.container.querySelector('canvas')!
    const visibleContext = getCanvasContext(visibleCanvas)
    visibleContext.drawImage.mockClear()

    rendered.rerender(<SourceComposition mediaId="same-media" src="blob:new" mediaType="video" />)
    sharedCompletion.resolve({ close: vi.fn() })
    await flushDeferredWork()

    expect(oldExtractor.drawFrame).not.toHaveBeenCalled()
    expect(visibleContext.drawImage).not.toHaveBeenCalled()
    expect(visibleCanvas.style.display).toBe('none')
  })

  it('ignores old extractor initialization after unmount and remount', async () => {
    const oldInit = deferred<boolean>()
    const oldExtractor = makeExtractor(oldInit.promise)
    decoderHarness.extractors.set('blob:old', oldExtractor)
    decoderHarness.extractors.set('blob:new', makeExtractor(Promise.resolve(false)))

    const oldRender = render(
      <SourceComposition mediaId="same-media" src="blob:old" mediaType="video" />,
    )
    await waitFor(() => expect(oldExtractor.init).toHaveBeenCalledOnce())
    oldRender.unmount()

    const newRender = render(
      <SourceComposition mediaId="same-media" src="blob:new" mediaType="video" />,
    )
    oldInit.resolve(true)
    await flushDeferredWork()

    expect(oldExtractor.drawFrame).not.toHaveBeenCalled()
    expect(newRender.container.querySelector('canvas')?.style.display).toBe('none')
  })
})
