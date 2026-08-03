import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeMediaPlaybackDiagnostics } from './media-playback-diagnostics'

describe('observeMediaPlaybackDiagnostics', () => {
  let now = 0
  let rafCallback: FrameRequestCallback | undefined
  let videoFrameCallback: VideoFrameRequestCallback | undefined

  beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('publishes browser presentation cadence separately from raf cadence', () => {
    const video = document.createElement('video')
    let totalVideoFrames = 100
    Object.defineProperty(video, 'getVideoPlaybackQuality', {
      configurable: true,
      value: () => ({ droppedVideoFrames: 3, totalVideoFrames }),
    })
    video.requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      videoFrameCallback = callback
      return 2
    })
    video.cancelVideoFrameCallback = vi.fn()

    const stop = observeMediaPlaybackDiagnostics(video)

    for (let i = 1; i <= 31; i += 1) {
      now = (i * 1000) / 60
      rafCallback?.(now)
      if (i % 2 === 0) {
        totalVideoFrames += 1
        videoFrameCallback?.(now, {
          expectedDisplayTime: now,
          height: 2250,
          mediaTime: i / 60,
          presentationTime: now,
          presentedFrames: i / 2,
          processingDuration: 0,
          receiveTime: now,
          rtpTimestamp: 0,
          width: 4000,
        })
      }
    }
    stop()

    expect(video.dataset.sourcePlaybackDiagnostics).toBe('complete')
    expect(Number(video.dataset.sourcePlaybackRafFps)).toBeCloseTo(60, 0)
    expect(Number(video.dataset.sourcePlaybackPresentedFps)).toBeCloseTo(29, 0)
    expect(Number(video.dataset.sourcePlaybackCallbackFps)).toBeCloseTo(30, 0)
    expect(video.dataset.sourcePlaybackPresentedFrames).toBe('15')
    expect(video.dataset.sourcePlaybackDroppedFrames).toBe('0')
    expect(video.dataset.sourcePlaybackTotalVideoFrames).toBe('15')
  })

  it('uses the cumulative presented-frame counter when callbacks are coalesced', () => {
    const video = document.createElement('video')
    video.requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      videoFrameCallback = callback
      return 2
    })
    video.cancelVideoFrameCallback = vi.fn()

    const stop = observeMediaPlaybackDiagnostics(video)
    const metadata = (presentedFrames: number, mediaTime: number) => ({
      expectedDisplayTime: now,
      height: 2250,
      mediaTime,
      presentationTime: now,
      presentedFrames,
      processingDuration: 0,
      receiveTime: now,
      rtpTimestamp: 0,
      width: 4000,
    })

    videoFrameCallback?.(0, metadata(10, 0))
    now = 100
    videoFrameCallback?.(100, metadata(16, 0.1))
    stop()

    expect(video.dataset.sourcePlaybackPresentedFrames).toBe('7')
    expect(Number(video.dataset.sourcePlaybackPresentedFps)).toBeCloseTo(60, 0)
    expect(Number(video.dataset.sourcePlaybackCallbackFps)).toBeCloseTo(60, 0)
  })
})
