import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  resolveMediaUrls: vi.fn(),
  runRender: vi.fn(),
  resolveClientSettings: vi.fn(),
  mapRequestedClientSettings: vi.fn(),
  trySmartCopyExport: vi.fn(),
  convertTimelineToComposition: vi.fn(),
  buildTranscriptSubtitleCues: vi.fn(),
  releaseTemporaryExportOutput: vi.fn(),
  setResult: vi.fn(),
}))

vi.mock('@/features/export/deps/media-library', () => ({
  resolveMediaUrls: mocks.resolveMediaUrls,
}))
vi.mock('../utils/smart-copy', () => ({ trySmartCopyExport: mocks.trySmartCopyExport }))
vi.mock('../utils/render-pipeline', () => ({
  isExtendedSettings: (settings: unknown) =>
    typeof settings === 'object' && settings !== null && 'mode' in settings,
  mapRequestedClientSettings: mocks.mapRequestedClientSettings,
  resolveClientSettings: mocks.resolveClientSettings,
  runRender: mocks.runRender,
}))
vi.mock('../utils/timeline-to-composition', () => ({
  convertTimelineToComposition: mocks.convertTimelineToComposition,
}))
vi.mock('../utils/embedded-subtitle-export', () => ({
  buildTranscriptSubtitleCues: mocks.buildTranscriptSubtitleCues,
}))
vi.mock('@/shared/utils/subtitles', () => ({ serializeSrt: vi.fn(() => '') }))
vi.mock('../utils/export-output-target', () => ({
  releaseTemporaryExportOutput: mocks.releaseTemporaryExportOutput,
}))
vi.mock('../utils/client-renderer', () => ({
  formatBytes: (bytes: number) => `${bytes} bytes`,
  estimateFileSize: vi.fn(() => 1),
  getSupportedCodecs: vi.fn(async () => []),
  getVideoBitrateForQuality: vi.fn(() => 1),
  mapToClientSettings: vi.fn(() => ({})),
}))
vi.mock('@/features/export/deps/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      tracks: [],
      items: [],
      transitions: [],
      fps: 30,
      inPoint: null,
      outPoint: null,
      keyframes: [],
      busAudioEq: [],
      masterBusDb: 0,
      backgroundColor: '#000',
      width: 1920,
      height: 1080,
    }),
  },
}))
vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: null }) },
}))
vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: { getState: () => ({}) },
}))
vi.mock('./client-render-source', () => ({
  resolveClientRenderSource: (_sequence: unknown, state: unknown) => state,
}))
vi.mock('@/shared/projects/defaults', () => ({
  DEFAULT_PROJECT_WIDTH: 1920,
  DEFAULT_PROJECT_HEIGHT: 1080,
}))
vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    startEvent: () => ({ set: vi.fn(), merge: vi.fn(), success: vi.fn(), failure: vi.fn() }),
    warn: vi.fn(),
    event: vi.fn(),
  }),
  createOperationId: () => 'test-op',
}))

import { useClientRender } from './use-client-render'

const settings = { quality: 'medium', resolution: { width: 640, height: 360 } } as Record<
  string,
  unknown
>
const renderedResult = {
  blob: new Blob(['encoded']),
  fileSize: 7,
  duration: 1,
  mimeType: 'video/mp4',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trySmartCopyExport.mockResolvedValue({ result: null })
  const clientSettings = {
    resolution: { width: 640, height: 360 },
    subtitleMode: 'burn',
    codec: 'avc',
    container: 'mp4',
  }
  mocks.mapRequestedClientSettings.mockReturnValue({
    clientSettings,
    exportMode: 'video',
    renderWholeProject: false,
  })
  mocks.resolveClientSettings.mockImplementation(async (settings: { subtitleMode?: string }) => ({
    clientSettings: { ...clientSettings, subtitleMode: settings.subtitleMode ?? 'burn' },
    exportMode: 'video',
    renderWholeProject: false,
  }))
  mocks.convertTimelineToComposition.mockReturnValue({ tracks: [], durationInFrames: 30 })
  mocks.resolveMediaUrls.mockImplementation(async (tracks: unknown) => tracks)
  mocks.buildTranscriptSubtitleCues.mockReturnValue([])
  mocks.releaseTemporaryExportOutput.mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('useClientRender lifecycle ownership', () => {
  it('aborts the active render on unmount and propagates its signal through media resolution', async () => {
    const render = deferred<typeof renderedResult>()
    mocks.runRender.mockReturnValue(
      render.promise.then((result) => ({ result, renderPath: 'worker' })),
    )
    const hook = renderHook(() => useClientRender())

    let exportPromise!: Promise<void>
    await act(async () => {
      exportPromise = hook.result.current.startExport(settings as never)
      await Promise.resolve()
    })
    expect(mocks.resolveMediaUrls).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ useProxy: false, signal: expect.any(AbortSignal) }),
    )
    const signal = mocks.resolveMediaUrls.mock.calls[0]![1].signal as AbortSignal
    hook.unmount()
    expect(signal.aborted).toBe(true)
    render.resolve(renderedResult)
    await act(async () => {
      await exportPromise
    })
  })

  it('aborts replacement renders and releases a result that becomes stale', async () => {
    const first = deferred<typeof renderedResult>()
    const second = deferred<typeof renderedResult>()
    mocks.runRender
      .mockReturnValueOnce(first.promise.then((result) => ({ result, renderPath: 'worker' })))
      .mockReturnValueOnce(second.promise.then((result) => ({ result, renderPath: 'worker' })))
    const hook = renderHook(() => useClientRender())
    let firstExport!: Promise<void>
    await act(async () => {
      firstExport = hook.result.current.startExport(settings as never)
      await Promise.resolve()
    })
    const firstSignal = mocks.runRender.mock.calls[0]![0].signal as AbortSignal
    let secondExport!: Promise<void>
    await act(async () => {
      secondExport = hook.result.current.startExport(settings as never)
      await Promise.resolve()
    })
    expect(firstSignal.aborted).toBe(true)
    first.resolve(renderedResult)
    second.resolve({ ...renderedResult, blob: new Blob(['second']) })
    await act(async () => {
      await Promise.all([firstExport, secondExport])
    })
    expect(mocks.releaseTemporaryExportOutput).toHaveBeenCalledWith(renderedResult)
  })

  it('releases a rendered output when finalization/update work throws before ownership transfer', async () => {
    const output = {
      ...renderedResult,
      temporaryOutput: { directory: 'scratch', fileName: 'out.mp4' },
    }
    mocks.runRender.mockResolvedValue({ result: output, renderPath: 'worker' })
    mocks.buildTranscriptSubtitleCues.mockImplementation(() => {
      throw new Error('state/update failed')
    })
    const hook = renderHook(() => useClientRender())
    await act(async () => {
      await hook.result.current.startExport({ ...settings, subtitleMode: 'sidecar' } as never)
    })
    expect(mocks.releaseTemporaryExportOutput).toHaveBeenCalledTimes(1)
    expect(mocks.releaseTemporaryExportOutput).toHaveBeenCalledWith(output)
  })

  it('releases a successfully owned result once on unmount, with reset/unmount causing no double release', async () => {
    mocks.runRender.mockResolvedValue({ result: renderedResult, renderPath: 'worker' })
    const hook = renderHook(() => useClientRender())
    await act(async () => {
      await hook.result.current.startExport(settings as never)
    })
    expect(hook.result.current.result).toBe(renderedResult)
    act(() => hook.result.current.resetState())
    hook.unmount()
    expect(mocks.releaseTemporaryExportOutput).toHaveBeenCalledTimes(1)
    expect(mocks.releaseTemporaryExportOutput).toHaveBeenCalledWith(renderedResult)
  })
})
