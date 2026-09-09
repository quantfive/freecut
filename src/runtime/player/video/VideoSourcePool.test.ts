import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { VideoSourcePool } from './VideoSourcePool'

type MutableVideoElement = HTMLVideoElement & {
  __setReadyState: (value: number) => void
  __setCurrentTime: (value: number) => void
  __setPaused: (value: boolean) => void
}

function installVideoElementMocks() {
  let autoLoad = true
  const createdVideos: MutableVideoElement[] = []
  const originalCreateElement = document.createElement.bind(document)

  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
  ) => {
    const element = originalCreateElement(tagName) as HTMLElement
    if (tagName !== 'video') {
      return element
    }

    const video = element as MutableVideoElement
    let readyStateValue = 0
    let currentTimeValue = 0
    let pausedValue = true

    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => readyStateValue,
    })
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTimeValue,
      set: (value: number) => {
        currentTimeValue = value
      },
    })
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get: () => 120,
    })
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      get: () => 1920,
    })
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      get: () => 1080,
    })
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => pausedValue,
    })

    video.__setReadyState = (value: number) => {
      readyStateValue = value
    }
    video.__setCurrentTime = (value: number) => {
      currentTimeValue = value
    }
    video.__setPaused = (value: boolean) => {
      pausedValue = value
    }

    video.load = vi.fn(() => {
      if (!autoLoad) return
      queueMicrotask(() => {
        readyStateValue = 2
        video.dispatchEvent(new Event('loadedmetadata'))
        video.dispatchEvent(new Event('canplay'))
      })
    })
    video.play = vi.fn(async () => {
      pausedValue = false
    })
    video.pause = vi.fn(() => {
      pausedValue = true
    })

    createdVideos.push(video)
    return video
  }) as typeof document.createElement)

  return {
    createdVideos,
    stallLoads: () => {
      autoLoad = false
    },
    restore: () => createElementSpy.mockRestore(),
  }
}

describe('VideoSourcePool', () => {
  let videoMocks: ReturnType<typeof installVideoElementMocks>

  beforeEach(() => {
    videoMocks = installVideoElementMocks()
  })

  afterEach(() => {
    videoMocks.restore()
    vi.useRealTimers()
  })

  it('keeps an assigned pending video intact after preload timeout so late data can play', async () => {
    vi.useFakeTimers()
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const loading = pool.preloadSource('blob:slow').catch((error: Error) => error)
    const video = pool.acquireForClip('clip', 'blob:slow') as MutableVideoElement
    video.__setPaused(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await loading).toMatchObject({ message: expect.stringContaining('timed out') })
    expect(video.getAttribute('src')).toBe('blob:slow')
    expect(video.pause).not.toHaveBeenCalled()
    expect(video.load).toHaveBeenCalledTimes(1)
    expect(pool.getClipElement('clip')).toBe(video)
    video.__setReadyState(4)
    video.dispatchEvent(new Event('canplay'))
    await pool.preloadSource('blob:slow')
    pool.releaseClip('clip')
    expect(pool.acquireForClip('next', 'blob:slow')).toBe(video)
    expect(video.getAttribute('src')).toBe('blob:slow')
    pool.dispose()
  })

  it('discards an unassigned timed-out video and permits a fresh preload', async () => {
    vi.useFakeTimers()
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const loading = pool.preloadSource('blob:slow').catch((error: Error) => error)
    const first = videoMocks.createdVideos[0]!
    await vi.advanceTimersByTimeAsync(15_000)
    await loading
    expect(first.getAttribute('src')).toBe('')
    expect(pool.getStats().totalElements).toBe(0)
    const retry = pool.preloadSource('blob:slow')
    const next = videoMocks.createdVideos[1]!
    next.dispatchEvent(new Event('canplay'))
    await retry
    expect(pool.acquireForClip('clip', 'blob:slow')).toBe(next)
    pool.dispose()
  })

  it('defers failed assigned video disposal until its owner releases it', async () => {
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const loading = pool.preloadSource('blob:broken').catch((error: Error) => error)
    const video = pool.acquireForClip('clip', 'blob:broken')!
    video.dispatchEvent(new Event('error'))
    expect(await loading).toBeInstanceOf(Error)
    expect(video.getAttribute('src')).toBe('blob:broken')
    expect(pool.getClipElement('clip')).toBe(video)
    pool.releaseClip('clip')
    expect(video.getAttribute('src')).toBe('')
    expect(pool.getStats().totalElements).toBe(0)
    const retry = pool.preloadSource('blob:broken')
    videoMocks.createdVideos[1]!.dispatchEvent(new Event('canplay'))
    await retry
    pool.dispose()
  })

  it('cleans up an unassigned media error before retrying', async () => {
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const loading = pool.preloadSource('blob:broken').catch((error: Error) => error)
    const video = videoMocks.createdVideos[0]!
    video.dispatchEvent(new Event('error'))
    expect(await loading).toBeInstanceOf(Error)
    expect(video.getAttribute('src')).toBe('')
    expect(pool.getStats().totalElements).toBe(0)
    const retry = pool.preloadSource('blob:broken')
    videoMocks.createdVideos[1]!.dispatchEvent(new Event('canplay'))
    await retry
    pool.dispose()
  })

  it('does not promote a ready video when disposal wins the completion microtask race', async () => {
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const controller = pool.getSource('blob:pending')
    const loading = pool.preloadSource('blob:pending').catch((error: Error) => error)
    const video = videoMocks.createdVideos[0]!
    video.dispatchEvent(new Event('canplay'))
    pool.dispose()
    expect(await loading).toMatchObject({ name: 'AbortError' })
    expect(controller.getElementCount()).toBe(0)
    expect(video.getAttribute('src')).toBe('')
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it('settles a pending preload on disposal without reviving or disposing its video twice', async () => {
    videoMocks.stallLoads()
    const pool = new VideoSourcePool()
    const loading = pool.preloadSource('blob:pending').catch((error: Error) => error)
    const video = pool.acquireForClip('clip', 'blob:pending')!
    pool.dispose()
    expect(await loading).toMatchObject({ name: 'AbortError' })
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.load).toHaveBeenCalledTimes(2)
    expect(pool.getStats()).toEqual({ sourceCount: 0, totalElements: 0, activeClips: 0 })
  })

  it('ensures ready lanes and warms idle elements near transition boundaries', async () => {
    const pool = new VideoSourcePool()

    await pool.ensureReadyLanes('blob:test-video', 2, {
      targetTimeSeconds: [5, 12],
      warmDecode: true,
    })

    expect(pool.getStats()).toEqual({
      sourceCount: 1,
      totalElements: 2,
      activeClips: 0,
    })
    expect(videoMocks.createdVideos).toHaveLength(2)
    expect(videoMocks.createdVideos[0]!.currentTime).toBe(5)
    expect(videoMocks.createdVideos[1]!.currentTime).toBe(12)
    expect(videoMocks.createdVideos[0]!.play).toHaveBeenCalledTimes(1)
    expect(videoMocks.createdVideos[1]!.play).toHaveBeenCalledTimes(1)
  })

  it('sets anonymous CORS before starting a remote media request', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    const requestModes: Array<string | null> = []
    const setter = vi.spyOn(HTMLMediaElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLMediaElement,
      value: string,
    ) {
      requestModes.push(this.crossOrigin)
      descriptor.set!.call(this, value)
    })
    const pool = new VideoSourcePool()
    try {
      expect(pool.acquireForClip('remote-clip', 'https://cdn.example.com/video.mp4')).not.toBeNull()
      expect(requestModes.length).toBeGreaterThan(0)
      expect(requestModes.every((mode) => mode === 'anonymous')).toBe(true)
    } finally {
      setter.mockRestore()
      pool.dispose()
    }
  })

  it('reuses a clip assignment during sticky release windows', async () => {
    vi.useFakeTimers()
    const pool = new VideoSourcePool()

    const firstElement = pool.acquireForClip('clip-1', 'blob:test-video')
    expect(firstElement).not.toBeNull()

    pool.releaseClip('clip-1', { delayMs: 400 })
    await vi.advanceTimersByTimeAsync(200)

    const reacquiredElement = pool.acquireForClip('clip-1', 'blob:test-video')
    expect(reacquiredElement).toBe(firstElement)

    await vi.advanceTimersByTimeAsync(500)
    expect(pool.getClipElement('clip-1')).toBe(firstElement)

    pool.releaseClip('clip-1')
    expect(pool.getClipElement('clip-1')).toBeNull()
  })

  it('disposes idle overflow elements created beyond the fixed lane pool', () => {
    const pool = new VideoSourcePool()

    const acquired = Array.from({ length: 5 }, (_, index) =>
      pool.acquireForClip(`clip-${index}`, 'blob:test-video'),
    )

    expect(acquired.every(Boolean)).toBe(true)
    expect(pool.getStats()).toEqual({
      sourceCount: 1,
      totalElements: 5,
      activeClips: 5,
    })

    pool.releaseClip('clip-4')

    expect(pool.getStats()).toEqual({
      sourceCount: 1,
      totalElements: 4,
      activeClips: 4,
    })
    expect(videoMocks.createdVideos[4]!.pause).toHaveBeenCalledTimes(1)
    expect(videoMocks.createdVideos[4]!.load).toHaveBeenCalledTimes(1)
  })
})
