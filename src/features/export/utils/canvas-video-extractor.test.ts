import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { VideoFrameExtractor } from './canvas-video-extractor'

describe('VideoFrameExtractor lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
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

  it('reports an expected no-sample fallback as structured debug telemetry only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      lastFailureKind: 'none' | 'no-sample' | 'decode-error'
      reportDrawFailure: (timestamp: number, clampedTime: number, error: unknown) => boolean
    }
    internals.lastFailureKind = 'no-sample'

    expect(internals.reportDrawFailure(1, 0.99, null)).toBe(false)

    expect(warn).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledWith(
      '[VideoFrameExtractor] Mediabunny frame extraction fallback',
      expect.objectContaining({ itemId: 'test-item', reason: 'no-sample', failures: 1 }),
    )
  })

  it('keeps a genuine decode failure visible as one clear warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const extractor = new VideoFrameExtractor('blob:test', 'test-item')
    const internals = extractor as unknown as {
      lastFailureKind: 'none' | 'no-sample' | 'decode-error'
      reportDrawFailure: (timestamp: number, clampedTime: number, error: unknown) => boolean
    }
    internals.lastFailureKind = 'decode-error'

    internals.reportDrawFailure(1, 0.99, new Error('decoder exploded'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[VideoFrameExtractor] Mediabunny frame extraction failed',
      expect.objectContaining({
        itemId: 'test-item',
        reason: 'decode-error',
        error: 'decoder exploded',
      }),
    )
  })
})
