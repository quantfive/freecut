// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const renderMocks = vi.hoisted(() => ({
  renderAudioOnly: vi.fn(),
  renderComposition: vi.fn(),
}))

vi.mock('./canvas-render-orchestrator', () => renderMocks)

import { runRender } from './render-pipeline'
import type { ClientExportSettings, ClientRenderResult } from './client-renderer'
import type { CompositionInputProps } from '@/types/export'

const result: ClientRenderResult = {
  blob: new Blob(['rendered']),
  fileSize: 8,
  duration: 1,
  mimeType: 'video/mp4',
}

const settings = {
  mode: 'video',
  codec: 'avc',
  container: 'mp4',
  resolution: { width: 640, height: 360 },
} as ClientExportSettings

function compositionWithAudio(): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 30,
    width: 640,
    height: 360,
    tracks: [
      {
        id: 'a1',
        name: 'A1',
        order: 0,
        height: 80,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        items: [
          {
            id: 'audio-1',
            trackId: 'a1',
            type: 'audio',
            from: 0,
            durationInFrames: 30,
            label: 'generated.wav',
            src: 'blob:generated',
          },
        ],
      },
    ],
  }
}

type WorkerBehavior = 'no-audio-context' | 'render-error' | 'runtime-error' | 'deferred-probe'

function installWorker(behavior: WorkerBehavior) {
  const messages: string[] = []
  const instances: FakeWorker[] = []

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminate = vi.fn()

    constructor() {
      instances.push(this)
    }

    postMessage(message: { type: string; requestId: string }) {
      messages.push(message.type)
      queueMicrotask(() => {
        if (message.type === 'probe') {
          if (behavior === 'deferred-probe') return
          this.onmessage?.({
            data: {
              type: 'capabilities',
              requestId: message.requestId,
              capabilities: { offlineAudioContext: behavior !== 'no-audio-context' },
            },
          } as MessageEvent)
          return
        }
        if (message.type !== 'start') return
        if (behavior === 'runtime-error') {
          this.onerror?.({
            message: 'worker crashed',
            filename: 'export-render.worker.ts',
            lineno: 12,
            colno: 3,
          } as ErrorEvent)
          return
        }
        this.onmessage?.({
          data: { type: 'error', requestId: message.requestId, error: 'ENCODER_FAILED:primary' },
        } as MessageEvent)
      })
    }
  }

  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
  return { messages, instances }
}

describe('runRender worker capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    renderMocks.renderComposition.mockResolvedValue(result)
    renderMocks.renderAudioOnly.mockResolvedValue(result)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preflights worker audio capability and routes normally to the main thread without errors', async () => {
    const { messages, instances } = installWorker('no-audio-context')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const outcome = await runRender({
      clientSettings: settings,
      exportMode: 'video',
      composition: compositionWithAudio(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })

    expect(messages).toEqual(['probe'])
    expect(outcome).toEqual({
      result,
      renderPath: 'main-thread',
      fallbackReason: 'WORKER_REQUIRES_MAIN_THREAD:audio-context',
    })
    expect(renderMocks.renderComposition).toHaveBeenCalledTimes(1)
    expect(instances[0]?.terminate).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('preserves a genuine worker render failure as the primary error', async () => {
    const { messages, instances } = installWorker('render-error')

    await expect(
      runRender({
        clientSettings: settings,
        exportMode: 'video',
        composition: compositionWithAudio(),
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('ENCODER_FAILED:primary')

    expect(messages).toEqual(['probe', 'start'])
    expect(renderMocks.renderComposition).not.toHaveBeenCalled()
    expect(instances[0]?.terminate).toHaveBeenCalledTimes(1)
  })

  it('does not disguise an actual worker runtime crash as a capability fallback', async () => {
    installWorker('runtime-error')

    await expect(
      runRender({
        clientSettings: settings,
        exportMode: 'video',
        composition: compositionWithAudio(),
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('EXPORT_WORKER_RUNTIME_ERROR:worker crashed @export-render.worker.ts:12:3')
    expect(renderMocks.renderComposition).not.toHaveBeenCalled()
  })

  it('settles cancellation during the capability probe without starting render work', async () => {
    const { messages, instances } = installWorker('deferred-probe')
    const controller = new AbortController()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    const pending = runRender({
      clientSettings: settings,
      exportMode: 'video',
      composition: compositionWithAudio(),
      signal: controller.signal,
      onProgress: vi.fn(),
    })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    await vi.waitFor(() => expect(messages).toEqual(['probe']))
    controller.abort()

    try {
      await rejection
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(messages).toEqual(['probe', 'cancel'])
      expect(renderMocks.renderComposition).not.toHaveBeenCalled()
      expect(instances[0]?.terminate).toHaveBeenCalledTimes(1)
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('routes a missing Worker capability directly to the main thread', async () => {
    vi.stubGlobal('Worker', undefined)

    const outcome = await runRender({
      clientSettings: settings,
      exportMode: 'video',
      composition: compositionWithAudio(),
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })

    expect(outcome).toEqual({
      result,
      renderPath: 'main-thread',
      fallbackReason: 'WORKER_UNAVAILABLE',
    })
    expect(renderMocks.renderComposition).toHaveBeenCalledTimes(1)
  })
})
