import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useMediaDependencyStore } from '@/features/preview/deps/timeline-store'
import type { TimelineTrack } from '@/types/timeline'
import { usePreviewMediaResolution } from './use-preview-media-resolution'

const resolverHarness = vi.hoisted(() => ({
  epoch: 0,
  resolveMediaUrl: vi.fn(() => new Promise<string | null>(() => {})),
}))

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: resolverHarness.resolveMediaUrl,
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: (mediaId: string) => (mediaId === 'media-priority' ? 'blob:priority' : null),
    getEpoch: () => String(resolverHarness.epoch),
    invalidateAll: vi.fn(),
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeHookParams() {
  return {
    fps: 30,
    combinedTracks: [] as TimelineTrack[],
    mediaResolveCostById: new Map<string, number>(),
    mediaDependencyVersion: 0,
    blobUrlVersion: 0,
    brokenMediaCount: 0,
    previewPerfRef: {
      current: {
        resolveSamples: 0,
        resolveTotalMs: 0,
        resolveTotalIds: 0,
        resolveLastMs: 0,
        resolveLastIds: 0,
      },
    },
    isGizmoInteractingRef: { current: false },
  }
}

const combinedTracks = [
  {
    id: 'track-video',
    items: [
      {
        id: 'item-priority',
        type: 'video',
        trackId: 'track-video',
        mediaId: 'media-priority',
        from: 0,
        durationInFrames: 120,
      },
      {
        id: 'item-slow',
        type: 'video',
        trackId: 'track-video',
        mediaId: 'media-slow',
        from: 3_000,
        durationInFrames: 120,
      },
    ],
  },
] as unknown as TimelineTrack[]

describe('usePreviewMediaResolution', () => {
  afterEach(() => {
    resolverHarness.epoch = 0
    resolverHarness.resolveMediaUrl.mockReset()
    resolverHarness.resolveMediaUrl.mockImplementation(() => new Promise<string | null>(() => {}))
    useMediaDependencyStore.setState({ mediaIds: [], mediaDependencyVersion: 0 })
  })

  it('releases the renderer gate when priority media resolves before the initial batch', async () => {
    useMediaDependencyStore.setState({
      mediaIds: ['media-priority', 'media-slow'],
      mediaDependencyVersion: 1,
    })

    const previewPerfRef = {
      current: {
        resolveSamples: 0,
        resolveTotalMs: 0,
        resolveTotalIds: 0,
        resolveLastMs: 0,
        resolveLastIds: 0,
      },
    }
    const isGizmoInteractingRef = { current: false }

    const { result, unmount } = renderHook(() =>
      usePreviewMediaResolution({
        fps: 30,
        combinedTracks,
        mediaResolveCostById: new Map(),
        mediaDependencyVersion: 1,
        blobUrlVersion: 0,
        brokenMediaCount: 0,
        previewPerfRef,
        isGizmoInteractingRef,
      }),
    )

    await waitFor(() => {
      expect(result.current.isResolving).toBe(true)
    })

    act(() => {
      result.current.setResolvedUrls(new Map([['media-priority', 'blob:priority']]))
    })

    await waitFor(() => {
      expect(result.current.isResolving).toBe(false)
    })

    unmount()
  })

  it('deduplicates only within the current media epoch while an old request drains', async () => {
    const oldResolution = deferred<string | null>()
    const newResolution = deferred<string | null>()
    resolverHarness.resolveMediaUrl
      .mockReturnValueOnce(oldResolution.promise)
      .mockReturnValueOnce(newResolution.promise)
    const { result } = renderHook(() => usePreviewMediaResolution(makeHookParams()))

    const firstBatch = result.current.resolveMediaBatch(['media-race'])
    await waitFor(() => expect(resolverHarness.resolveMediaUrl).toHaveBeenCalledTimes(1))

    resolverHarness.epoch += 1
    const secondBatch = result.current.resolveMediaBatch(['media-race'])
    await waitFor(() => expect(resolverHarness.resolveMediaUrl).toHaveBeenCalledTimes(2))

    const thirdBatch = result.current.resolveMediaBatch(['media-race'])
    expect(resolverHarness.resolveMediaUrl).toHaveBeenCalledTimes(2)

    oldResolution.resolve(null)
    await expect(firstBatch).resolves.toEqual({
      resolvedEntries: [],
      failedIds: ['media-race'],
    })
    expect(resolverHarness.resolveMediaUrl).toHaveBeenCalledTimes(2)

    newResolution.resolve('blob:new-source')
    const expected = {
      resolvedEntries: [{ mediaId: 'media-race', url: 'blob:new-source' }],
      failedIds: [],
    }
    await expect(secondBatch).resolves.toEqual(expected)
    await expect(thirdBatch).resolves.toEqual(expected)
  })
})
