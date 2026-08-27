// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { consumeVideoSamples } from './consume-video-samples'

describe('consumeVideoSamples', () => {
  it('closes a yielded sample when cancellation wins before consumption', async () => {
    const sample = { close: vi.fn() }
    let iteratorFinalized = false
    async function* samples() {
      try {
        yield sample
      } finally {
        iteratorFinalized = true
      }
    }
    const consume = vi.fn()

    await consumeVideoSamples(samples(), [1], () => false, consume)

    expect(consume).not.toHaveBeenCalled()
    expect(sample.close).toHaveBeenCalledOnce()
    expect(iteratorFinalized).toBe(true)
  })

  it('skips a null sample and keeps consuming later timestamps', async () => {
    const sample = { close: vi.fn() }
    async function* samples() {
      yield null
      yield sample
    }
    const consume = vi.fn()

    await consumeVideoSamples(samples(), [1, 2], () => true, consume)

    expect(consume).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledWith(sample, 2)
    expect(sample.close).toHaveBeenCalledOnce()
  })
})
