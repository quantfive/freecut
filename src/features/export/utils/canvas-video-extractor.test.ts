import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { VideoFrameExtractor } from './canvas-video-extractor'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VideoFrameExtractor lifecycle', () => {
  it('closes a sample yielded after the extractor was disposed', async () => {
    let resolveNext!: (result: IteratorResult<{ close: () => void }>) => void
    const nextResult = new Promise<IteratorResult<{ close: () => void }>>((resolve) => {
      resolveNext = resolve
    })
    const sample = { close: vi.fn() }
    const iterator = {
      next: vi.fn(() => nextResult),
      return: vi.fn(async () => ({ value: undefined, done: true as const })),
      throw: vi.fn(async (error: unknown) => {
        throw error
      }),
      [Symbol.asyncIterator]() {
        return this
      },
    }

    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      sampleIterator: typeof iterator | null
      peekNextSample: () => Promise<{ close: () => void } | null>
    }
    internals.sampleIterator = iterator

    const pendingSample = internals.peekNextSample()
    extractor.dispose()
    resolveNext({ value: sample, done: false })

    await expect(pendingSample).resolves.toBeNull()
    expect(sample.close).toHaveBeenCalledTimes(1)
    expect(iterator.return).toHaveBeenCalledTimes(1)
  })

  it('reuses one oriented capture surface while retaining batch-prewarmed frames', async () => {
    const capturedBitmaps: ImageBitmap[] = []
    const captureContext = { clearRect: vi.fn() }
    const canvasInstances: MockOffscreenCanvas[] = []
    class MockOffscreenCanvas {
      readonly transferToImageBitmap = vi.fn(() => {
        const bitmap = { close: vi.fn(), width: 64, height: 36 } as unknown as ImageBitmap
        capturedBitmaps.push(bitmap)
        return bitmap
      })
      constructor(
        public width: number,
        public height: number,
      ) {
        canvasInstances.push(this)
      }
      getContext() {
        return captureContext
      }
    }
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)

    const samples = [1, 2].map((timestamp) => ({
      timestamp,
      draw: vi.fn(),
      toVideoFrame: vi.fn(() => null),
      close: vi.fn(),
    }))
    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      ready: boolean
      videoTrack: { displayWidth: number; displayHeight: number }
      sink: {
        samplesAtTimestamps: () => AsyncGenerator<(typeof samples)[number], void, unknown>
      }
    }
    internals.ready = true
    internals.videoTrack = { displayWidth: 64, displayHeight: 36 }
    internals.sink = {
      async *samplesAtTimestamps() {
        for (const sample of samples) yield sample
      },
    }
    const retained: Array<{ frame: ImageBitmap | VideoFrame; sourceTime: number }> = []

    await expect(
      extractor.prewarmBatch(
        {} as CanvasRenderingContext2D,
        [1, 2],
        0,
        0,
        1,
        1,
        (frame, sourceTime) => retained.push({ frame, sourceTime }),
      ),
    ).resolves.toBe(2)

    expect(canvasInstances).toHaveLength(1)
    expect(captureContext.clearRect).toHaveBeenCalledTimes(2)
    expect(samples[0]!.draw).toHaveBeenCalledOnce()
    expect(samples[1]!.draw).toHaveBeenCalledOnce()
    expect(samples[0]!.close).toHaveBeenCalledOnce()
    expect(samples[1]!.close).toHaveBeenCalledOnce()
    expect(retained.map(({ sourceTime }) => sourceTime)).toEqual([1, 2])
    expect(retained.map(({ frame }) => frame)).toEqual(capturedBitmaps)
  })
})
