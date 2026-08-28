import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import type { VideoItem } from '@/types/timeline'

const renderTaskState = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  renderItemWithEffects: vi.fn(async () => {
    await renderTaskState.wait
    return null
  }),
}))

vi.mock('./frame-render-tasks', () => ({
  renderItemWithEffects: renderTaskState.renderItemWithEffects,
  renderTransitionFallbackCanvas: vi.fn(async () => ({ poolCanvases: [] })),
}))

import { createCompositionRenderer } from './client-render-engine'

function createContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const values: Record<PropertyKey, unknown> = { canvas }
  return new Proxy(values, {
    get(target, property) {
      if (!(property in target)) target[property] = vi.fn()
      return target[property]
    },
    set(target, property, value) {
      target[property] = value
      return true
    },
  }) as unknown as OffscreenCanvasRenderingContext2D
}

class FakeOffscreenCanvas {
  readonly context: OffscreenCanvasRenderingContext2D

  constructor(
    public width: number,
    public height: number,
  ) {
    this.context = createContext(this as unknown as OffscreenCanvas)
  }

  getContext(type: string) {
    return type === '2d' ? this.context : null
  }
}

function frame() {
  return { close: vi.fn() } as unknown as ImageBitmap
}

function videoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'retained-clip',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Retained clip',
    mediaId: 'media-1',
    src: 'blob:media-1',
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 300,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  }
}

function composition(item: VideoItem): CompositionInputProps {
  return {
    fps: 30,
    width: 320,
    height: 180,
    tracks: [
      {
        id: 'track-1',
        name: 'V1',
        order: 0,
        visible: true,
        muted: false,
        solo: false,
        locked: false,
        height: 60,
        items: [item],
      },
    ],
    transitions: [],
    keyframes: [],
  }
}

async function createHarness() {
  const initial = videoItem()
  let live = initial
  const canvas = new FakeOffscreenCanvas(320, 180) as unknown as OffscreenCanvas
  const renderer = await createCompositionRenderer(
    composition(initial),
    canvas,
    canvas.getContext('2d')!,
    {
      mode: 'preview',
      getLiveItemSnapshot: () => live,
    },
  )
  return { renderer, setLive: (item: VideoItem) => (live = item) }
}

describe('client renderer retained source mapping', () => {
  beforeEach(() => {
    renderTaskState.wait = null
    renderTaskState.renderItemWithEffects.mockClear()
    ;(globalThis as unknown as { OffscreenCanvas: typeof FakeOffscreenCanvas }).OffscreenCanvas =
      FakeOffscreenCanvas
    globalThis.createImageBitmap = vi.fn(async () => frame())
  })

  it.each([
    ['sourceStart', { sourceStart: 90, sourceEnd: 120 }],
    ['sourceEnd', { sourceEnd: 120 }],
  ])('evicts per-item and composition frames when %s changes', async (_name, change) => {
    const { renderer, setLive } = await createHarness()
    const cache = renderer.getScrubbingCache()!
    const changedItemFrame = frame()
    const reusableOtherItemFrame = frame()
    const staleCompositionFrame = frame()
    cache.putVideoFrame('retained-clip', changedItemFrame, 0)
    cache.putVideoFrame('other-clip', reusableOtherItemFrame, 0)
    cache.putRamFrame(0, staleCompositionFrame)

    setLive(videoItem(change))
    await renderer.renderFrame(0)

    expect(changedItemFrame.close).toHaveBeenCalledTimes(1)
    expect(cache.getVideoFrameEntry('retained-clip')).toBeUndefined()
    expect(reusableOtherItemFrame.close).not.toHaveBeenCalled()
    expect(cache.getVideoFrameEntry('other-clip')?.frame).toBe(reusableOtherItemFrame)
    expect(staleCompositionFrame.close).toHaveBeenCalledTimes(1)
    renderer.dispose()
  })

  it('keeps decoded frames stable for unchanged mapping and transform-only invalidation', async () => {
    const { renderer, setLive } = await createHarness()
    const cache = renderer.getScrubbingCache()!
    const reusableDecodedFrame = frame()
    const staleCompositionFrame = frame()
    cache.putVideoFrame('retained-clip', reusableDecodedFrame, 0)
    cache.putRamFrame(0, staleCompositionFrame)

    setLive(
      videoItem({
        transform: { x: 10, y: 0, width: 320, height: 180, rotation: 0, opacity: 1 },
      }),
    )
    renderer.invalidateFrameCache({ frames: [0] })
    await renderer.renderFrame(0)

    expect(staleCompositionFrame.close).toHaveBeenCalledTimes(1)
    expect(reusableDecodedFrame.close).not.toHaveBeenCalled()
    expect(cache.getVideoFrameEntry('retained-clip')?.frame).toBe(reusableDecodedFrame)
    renderer.dispose()
  })

  it('aborts an in-flight old mapping before its pixels can be cached', async () => {
    let release!: () => void
    renderTaskState.wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const { renderer, setLive } = await createHarness()

    const pendingRender = renderer.renderFrame(0)
    await vi.waitFor(() => expect(renderTaskState.renderItemWithEffects).toHaveBeenCalled())
    setLive(videoItem({ sourceStart: 90, sourceEnd: 120 }))
    release()
    await pendingRender

    expect(renderer.wasLastRenderAborted()).toBe(true)
    expect(renderer.getScrubbingCache()!.getFrame(0)).toBeNull()
    renderer.dispose()
  })
})
