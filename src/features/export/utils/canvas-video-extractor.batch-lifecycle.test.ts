import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const harness = vi.hoisted(() => ({
  input: null as { dispose: ReturnType<typeof vi.fn> } | null,
  sample: null as { draw: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } | null,
  batchStarted: null as (() => void) | null,
  batchStartedPromise: null as Promise<void> | null,
  releaseBatch: null as (() => void) | null,
  releaseBatchPromise: null as Promise<void> | null,
}))

vi.mock('@/infrastructure/browser/mediabunny-input-source', () => ({
  createMediabunnyInputSource: vi.fn(() => ({})),
}))

vi.mock('@/infrastructure/browser/register-prores-decoder', () => ({
  ensureProResDecoderRegistered: vi.fn(async () => undefined),
}))

vi.mock('mediabunny', () => {
  class Input {
    dispose = vi.fn()

    constructor() {
      harness.input = this
    }

    async getPrimaryVideoTrack() {
      return {
        displayWidth: 1,
        displayHeight: 1,
        canDecode: async () => true,
        canBeTransparent: async () => false,
      }
    }

    async computeDuration() {
      return 1
    }
  }

  class VideoSampleSink {
    constructor() {}

    samples() {
      return (async function* () {})()
    }

    samplesAtTimestamps() {
      return (async function* () {
        harness.batchStarted?.()
        await harness.releaseBatchPromise
        yield harness.sample
      })()
    }
  }

  return { ALL_FORMATS: {}, Input, VideoSampleSink }
})

import { VideoFrameExtractor } from './canvas-video-extractor'

describe('VideoFrameExtractor batch teardown', () => {
  beforeEach(() => {
    harness.input = null
    harness.sample = { draw: vi.fn(), close: vi.fn() }
    harness.batchStartedPromise = new Promise<void>((resolve) => {
      harness.batchStarted = resolve
    })
    harness.releaseBatchPromise = new Promise<void>((resolve) => {
      harness.releaseBatch = resolve
    })
  })

  it('defers input disposal until an in-flight batch has released its samples', async () => {
    const extractor = new VideoFrameExtractor('blob:test', 'batch-test')
    await expect(extractor.init()).resolves.toBe(true)

    const batch = extractor.prewarmBatch({} as CanvasRenderingContext2D, [0], 0, 0, 1, 1)
    await harness.batchStartedPromise

    extractor.dispose()

    expect(harness.input?.dispose).not.toHaveBeenCalled()

    harness.releaseBatch?.()
    await expect(batch).resolves.toBe(1)
    expect(harness.sample?.close).toHaveBeenCalledOnce()
    expect(harness.input?.dispose).toHaveBeenCalledOnce()
  })
})
