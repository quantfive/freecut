import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createVideoFrameHandoff } from './video-frame-handoff'

function setup(pool: object = {}, track = 'video') {
  const video = document.createElement('video')
  const container = document.createElement('div')
  document.body.append(container)
  container.append(video)
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    videoWidth: { value: 640 },
    videoHeight: { value: 360 },
  })
  let next = 0
  const callbacks = new Map<number, VideoFrameRequestCallback>()
  video.requestVideoFrameCallback = vi.fn((cb) => {
    callbacks.set(++next, cb)
    return next
  })
  video.cancelVideoFrameCallback = vi.fn()
  const guard = createVideoFrameHandoff(video, container, pool, track, 0.067)
  const frame = (time: number, id = next) => {
    callbacks.get(id)?.(0, { mediaTime: time } as VideoFrameCallbackMetadata)
  }
  return { video, container, guard, frame }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('video frame handoff', () => {
  it('does not reveal recycled pixels based on currentTime, seeked, or an old decoded frame', () => {
    const { video, guard, frame } = setup()
    guard.prepare(10)
    video.currentTime = 10
    video.dispatchEvent(new Event('seeked'))
    frame(0)
    expect(video.style.opacity).toBe('0')
    frame(10)
    expect(video.style.opacity).toBe('')
    guard.dispose()
  })

  it('rejects the callback from an earlier seek generation and ignores callbacks after disposal', () => {
    const { video, guard, frame } = setup()
    guard.prepare(10)
    guard.prepare(20)
    frame(10, 1)
    expect(video.style.opacity).toBe('0')
    video.currentTime = 20
    frame(20)
    expect(video.style.opacity).toBe('')
    guard.prepare(30)
    guard.dispose()
    frame(30)
    expect(video.style.opacity).toBe('')
  })

  it('accepts an advanced first frame and rechecks a paused presented frame after seeked', () => {
    const { video, guard, frame } = setup()
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    guard.prepare(10)
    video.currentTime = 10.2
    frame(10.2)
    expect(video.style.opacity).toBe('')
    guard.prepare(20)
    video.currentTime = 20
    Object.defineProperty(video, 'seeking', { value: true, configurable: true })
    frame(20)
    expect(video.style.opacity).toBe('0')
    Object.defineProperty(video, 'seeking', { value: false, configurable: true })
    video.dispatchEvent(new Event('seeked'))
    expect(video.style.opacity).toBe('')
    guard.dispose()
  })

  it('waits for seek completion on engines without video frame callbacks', () => {
    vi.useFakeTimers()
    const { video, guard } = setup()
    Reflect.deleteProperty(video, 'requestVideoFrameCallback')
    guard.prepare(10)
    video.currentTime = 10
    Object.defineProperty(video, 'seeking', { configurable: true, value: true })
    vi.advanceTimersByTime(20)
    expect(video.style.opacity).toBe('0')
    Object.defineProperty(video, 'seeking', { configurable: true, value: false })
    video.dispatchEvent(new Event('seeked'))
    vi.advanceTimersByTime(20)
    expect(video.style.opacity).toBe('')
    guard.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the outgoing presented image across lane remounts, scoped to the Player and track', () => {
    const draw = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as ReturnType<HTMLCanvasElement['getContext']>)
    const pool = {}
    const outgoing = setup(pool)
    outgoing.guard.prepare(3)
    outgoing.video.currentTime = 3
    outgoing.frame(3)
    outgoing.guard.dispose()
    const incoming = setup(pool)
    incoming.guard.prepare(12)
    expect(incoming.container.querySelector('canvas')).not.toBeNull()
    expect(draw).toHaveBeenCalledWith(outgoing.video, 0, 0, 640, 360)
    incoming.frame(0)
    expect(incoming.container.querySelector('canvas')).not.toBeNull()
    incoming.video.currentTime = 12
    incoming.frame(12)
    expect(incoming.container.querySelector('canvas')).toBeNull()
    const otherTrack = setup(pool, 'other')
    otherTrack.guard.prepare(1)
    expect(otherTrack.container.querySelector('canvas')).toBeNull()
    const otherPlayer = setup()
    otherPlayer.guard.prepare(1)
    expect(otherPlayer.container.querySelector('canvas')).toBeNull()
    incoming.guard.dispose()
    otherTrack.guard.dispose()
    otherPlayer.guard.dispose()
  })
})
