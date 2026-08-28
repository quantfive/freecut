// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  clearObjectUrlRegistry,
  registerObjectUrl,
} from '@/infrastructure/browser/object-url-registry'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'

const getLevelMock = vi.fn()
const deleteMock = vi.fn()
const getCachedRangeMock = vi.fn()
const saveRangeMock = vi.fn()
const generateMultiResolutionMock = vi.fn(() => [])
const saveMock = vi.fn(async () => undefined)
const getWaveformMock = vi.fn(async () => undefined)
const getWaveformRecordMock = vi.fn(async () => undefined)
const getWaveformMetaMock = vi.fn(async () => undefined)
const getWaveformBinsMock = vi.fn(async () => [])
const saveWaveformBinMock = vi.fn(async () => undefined)
const saveWaveformMetaMock = vi.fn(async () => undefined)
const deleteWaveformMock = vi.fn(async () => undefined)

vi.mock('./waveform-opfs-storage', () => ({
  chooseLevelForZoom: vi.fn(() => 0),
  WAVEFORM_LEVELS: [500, 100, 25, 10],
  waveformOPFSStorage: {
    getLevel: getLevelMock,
    getCachedRange: getCachedRangeMock,
    saveRange: saveRangeMock,
    generateMultiResolution: generateMultiResolutionMock,
    save: saveMock,
    delete: deleteMock,
  },
}))

vi.mock('@/infrastructure/storage', () => ({
  getWaveform: getWaveformMock,
  getWaveformRecord: getWaveformRecordMock,
  getWaveformMeta: getWaveformMetaMock,
  getWaveformBins: getWaveformBinsMock,
  saveWaveformBin: saveWaveformBinMock,
  saveWaveformMeta: saveWaveformMetaMock,
  deleteWaveform: deleteWaveformMock,
}))

describe('waveformCache', () => {
  beforeEach(() => {
    getLevelMock.mockReset()
    getCachedRangeMock.mockReset()
    getCachedRangeMock.mockResolvedValue(null)
    saveRangeMock.mockReset()
    saveRangeMock.mockResolvedValue(undefined)
    deleteMock.mockReset()
    generateMultiResolutionMock.mockClear()
    saveMock.mockClear()
    getWaveformMock.mockReset().mockResolvedValue(undefined)
    getWaveformRecordMock.mockReset().mockResolvedValue(undefined)
    getWaveformMetaMock.mockReset().mockResolvedValue(undefined)
    getWaveformBinsMock.mockReset().mockResolvedValue([])
    saveWaveformBinMock.mockReset().mockResolvedValue(undefined)
    saveWaveformMetaMock.mockReset().mockResolvedValue(undefined)
    deleteWaveformMock.mockReset().mockResolvedValue(undefined)
    setWorkspaceRoot(null)
    clearObjectUrlRegistry()
  })

  afterEach(async () => {
    const { waveformCache } = await import('./waveform-cache')
    waveformCache.clearAll()
    setWorkspaceRoot(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('analyzes and caches host-mounted media without workspace persistence warnings', async () => {
    getLevelMock.mockResolvedValue(null)
    const persistenceFailure = new Error('workspace persistence should not be called')
    for (const storageMock of [
      getWaveformMock,
      getWaveformRecordMock,
      getWaveformMetaMock,
      getWaveformBinsMock,
      saveWaveformBinMock,
      saveWaveformMetaMock,
      deleteWaveformMock,
    ]) {
      storageMock.mockRejectedValue(persistenceFailure)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
    )

    const close = vi.fn(async () => undefined)
    const decodeAudioData = vi.fn(async () => ({
      duration: 1,
      numberOfChannels: 1,
      length: 4,
      getChannelData: () => new Float32Array([0, 0.5, -0.25, 1]),
    }))
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return { close, decodeAudioData }
      }),
    )

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform(
      'host-mounted-media',
      'blob:http://localhost/host-mounted',
    )
    const cached = await waveformCache.getCachedWaveform('host-mounted-media')

    expect(decodeAudioData).toHaveBeenCalledTimes(1)
    expect(waveform.peaks.length).toBe(500)
    expect(cached).toBe(waveform)
    expect(generateMultiResolutionMock).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledOnce())
    for (const storageMock of [
      getWaveformMock,
      getWaveformRecordMock,
      getWaveformMetaMock,
      getWaveformBinsMock,
      saveWaveformBinMock,
      saveWaveformMetaMock,
      deleteWaveformMock,
    ]) {
      expect(storageMock).not.toHaveBeenCalled()
    }
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('keeps configured workspace persistence failures observable', async () => {
    setWorkspaceRoot({ name: 'workspace' } as FileSystemDirectoryHandle)
    const persistenceFailure = new Error('configured workspace read failed')
    getWaveformMetaMock.mockRejectedValueOnce(persistenceFailure)
    getLevelMock.mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { waveformCache } = await import('./waveform-cache')
    await expect(waveformCache.getCachedWaveform('configured-workspace-media')).resolves.toBeNull()

    expect(getWaveformMetaMock).toHaveBeenCalledWith('configured-workspace-media')
    expect(warn).toHaveBeenCalledWith(
      '[WaveformCache] Failed to load binned waveform from IndexedDB: configured-workspace-media',
      persistenceFailure,
    )
  })

  it('preserves stereo channel metadata when loading from OPFS', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.8, 0.2, 1.0, 0.3]),
      channels: 2,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform('media-stereo', 'blob:unused')

    expect(waveform.channels).toBe(2)
    expect(waveform.stereo).toBe(true)
    expect(waveform.duration).toBeCloseTo(0.004, 6)
    expect(waveform.peaks[0]).toBeCloseTo(0.8, 6)
    expect(waveform.peaks[1]).toBeCloseTo(0.2, 6)
    expect(waveform.peaks[2]).toBeCloseTo(1, 6)
    expect(waveform.peaks[3]).toBeCloseTo(0.3, 6)
  })

  it('loads persisted waveform data without requiring a blob URL', async () => {
    getLevelMock.mockResolvedValue({
      sampleRate: 500,
      peaks: new Float32Array([0.5, 0.25]),
      channels: 1,
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getCachedWaveform('media-cached')

    expect(waveform).not.toBeNull()
    expect(waveform?.duration).toBeCloseTo(0.004, 6)
    expect(waveform?.peaks[0]).toBeCloseTo(0.5, 6)
    expect(waveform?.peaks[1]).toBeCloseTo(0.25, 6)
  })

  it('hydrates visible waveform ranges from the range cache before decoding', async () => {
    getCachedRangeMock.mockResolvedValue({
      duration: 120,
      channels: 1,
      sampleRate: 100,
      startSample: 100,
      peaks: new Float32Array(12000),
    })

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.prepareVisibleWaveformRange(
      'media-range',
      'blob:unused',
      1,
      3,
      300,
    )

    expect(getCachedRangeMock).toHaveBeenCalledWith('media-range', 100, 1, 3)
    expect(waveform?.sampleRate).toBe(100)
    expect(waveform?.isComplete).toBe(false)
    expect(waveform?.duration).toBe(120)
  })

  it('routes an unregistered generated blob source directly to the main thread without warning', async () => {
    getLevelMock.mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const workerConstructor = vi.fn(() => {
      throw new Error('worker should not be constructed for an unregistered blob source')
    })
    vi.stubGlobal('Worker', workerConstructor)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
    )

    const close = vi.fn(async () => undefined)
    const decodeAudioData = vi.fn(async () => ({
      duration: 1,
      numberOfChannels: 1,
      length: 4,
      getChannelData: () => new Float32Array([0, 0.5, -0.25, 1]),
    }))
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return { close, decodeAudioData }
      }),
    )

    const { waveformCache } = await import('./waveform-cache')
    const waveform = await waveformCache.getWaveform(
      'generated-unregistered',
      'blob:http://localhost/generated',
    )

    expect(workerConstructor).not.toHaveBeenCalled()
    expect(decodeAudioData).toHaveBeenCalledTimes(1)
    expect(waveform.isComplete).toBe(true)
    expect(waveform.peaks.length).toBe(500)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('transfers one registered blob source for concurrent waveform callers without duplicate work', async () => {
    getLevelMock.mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sourceBlob = new Blob(['generated-audio'], { type: 'audio/wav' })
    registerObjectUrl('blob:registered-generated', sourceBlob)
    const generateMessages: Array<{ blob?: Blob; requestId: string }> = []
    let workerInstances = 0

    class SuccessfulWaveformWorker {
      private listeners = new Map<string, Set<(event: MessageEvent) => void>>()
      terminate = vi.fn()

      constructor() {
        workerInstances += 1
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }

      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.get(type)?.delete(listener)
      }

      postMessage(message: { type: string; requestId: string; blob?: Blob }) {
        if (message.type !== 'generate') return
        generateMessages.push(message)
        queueMicrotask(() => {
          const emit = (data: object) => {
            for (const listener of this.listeners.get('message') ?? []) {
              listener({ data } as MessageEvent)
            }
          }
          emit({
            type: 'init',
            requestId: message.requestId,
            duration: 1,
            channels: 1,
            sampleRate: 500,
            totalSamples: 2,
            stereo: false,
          })
          emit({
            type: 'chunk',
            requestId: message.requestId,
            startIndex: 0,
            peaks: new Float32Array([0.25, 0.75]),
          })
          emit({ type: 'complete', requestId: message.requestId, maxPeak: 0.75 })
        })
      }
    }

    vi.stubGlobal('Worker', SuccessfulWaveformWorker as unknown as typeof Worker)

    const { waveformCache } = await import('./waveform-cache')
    const [first, second] = await Promise.all([
      waveformCache.getWaveform('registered-generated', 'blob:registered-generated'),
      waveformCache.getWaveform('registered-generated', 'blob:registered-generated'),
    ])

    expect(workerInstances).toBe(1)
    expect(generateMessages).toHaveLength(1)
    expect(generateMessages[0]?.blob).toBe(sourceBlob)
    expect(first).toBe(second)
    expect(first.peaks).toEqual(new Float32Array([0.25, 0.75]))
    expect(warn).not.toHaveBeenCalled()
    waveformCache.dispose()
  })

  it('settles an aborted main-thread waveform fallback without duplicate work or unhandled noise', async () => {
    getLevelMock.mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const workerConstructor = vi.fn(() => {
      throw new Error('worker should not be constructed for an unregistered blob source')
    })
    vi.stubGlobal('Worker', workerConstructor)

    let fetchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    const fetchMock = vi.fn((_url: string, options?: { signal?: AbortSignal }) => {
      fetchStarted()
      return new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const { waveformCache } = await import('./waveform-cache')
      const first = waveformCache.getWaveform('generated-abort', 'blob:http://localhost/aborted')
      const second = waveformCache.getWaveform('generated-abort', 'blob:http://localhost/aborted')
      const firstRejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
      const secondRejection = expect(second).rejects.toMatchObject({ name: 'AbortError' })

      await started
      waveformCache.abort('generated-abort')

      await Promise.all([firstRejection, secondRejection])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(workerConstructor).not.toHaveBeenCalled()
      expect(waveformCache.hasPendingGeneration('generated-abort')).toBe(false)
      expect(unhandledRejections).toEqual([])
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})
