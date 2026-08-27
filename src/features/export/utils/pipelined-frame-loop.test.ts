// @vitest-environment node

// Real coverage of the extracted export frame loop (replaces the old
// canvas-render-orchestrator.test.ts mock-echo, which re-implemented the loop
// shape on mocks without importing production code). End-to-end protection of
// the full orchestrator remains the headless chrome e2e (headless/test.mjs).

import { describe, it, expect, vi } from 'vite-plus/test'
import {
  createPipelinedFrameLoopFailureState,
  runPipelinedFrameLoop,
  type PipelinedFrameLoopFailureState,
} from './pipelined-frame-loop'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface FakeSample {
  frame: number
  closed: boolean
  close(): void
}

interface HarnessOptions {
  signal?: AbortSignal
  failureState?: PipelinedFrameLoopFailureState
  renderImpl?: (frame: number) => void | Promise<void>
  encodeImpl?: (sample: FakeSample, keyFrame: boolean) => Promise<void>
  closeImpl?: (sample: FakeSample) => void
  onAbortImpl?: () => void | Promise<void>
}

function createHarness(totalFrames: number, opts: HarnessOptions = {}) {
  const events: string[] = []
  const samples: FakeSample[] = []
  const failureState = opts.failureState ?? createPipelinedFrameLoopFailureState()

  const run = () =>
    runPipelinedFrameLoop<FakeSample>({
      totalFrames,
      signal: opts.signal,
      failureState,
      renderFrame: async (frame, reportFailure) => {
        events.push(`render-${frame}`)
        try {
          await opts.renderImpl?.(frame)
        } catch (error) {
          reportFailure(error)
          throw error
        }
      },
      captureSample: (frame) => {
        const sample: FakeSample = {
          frame,
          closed: false,
          close() {
            this.closed = true
            events.push(`close-${frame}`)
            opts.closeImpl?.(this)
          },
        }
        samples.push(sample)
        events.push(`capture-${frame}`)
        return sample
      },
      encodeSample: (sample, keyFrame, reportFailure) => {
        events.push(`encode-start-${sample.frame}${keyFrame ? '-key' : ''}`)
        const encoding = opts.encodeImpl?.(sample, keyFrame) ?? Promise.resolve()
        void encoding.catch(reportFailure)
        return encoding.then(() => {
          events.push(`encode-end-${sample.frame}`)
        })
      },
      onAbort: async () => {
        events.push('abort-cancel')
        await opts.onAbortImpl?.()
      },
      onFrameProgress: (frame) => {
        events.push(`progress-${frame}`)
      },
    })

  return { events, samples, failureState, run }
}

const indexOf = (events: string[], event: string) => {
  const index = events.indexOf(event)
  expect(index, `expected event "${event}" in trace ${JSON.stringify(events)}`).toBeGreaterThan(-1)
  return index
}

type FailureSource = 'render' | 'encode' | 'abort' | 'audio'

interface FailureOrderCase {
  name: string
  first: FailureSource
  second: FailureSource
  expected: FailureSource
}

const failureOrderCases: FailureOrderCase[] = [
  { name: 'render first then abort', first: 'render', second: 'abort', expected: 'render' },
  { name: 'render first then audio', first: 'render', second: 'audio', expected: 'render' },
  { name: 'encode first then abort', first: 'encode', second: 'abort', expected: 'encode' },
  { name: 'abort first then render', first: 'abort', second: 'render', expected: 'abort' },
  { name: 'abort first then encode', first: 'abort', second: 'encode', expected: 'abort' },
  { name: 'audio first then render', first: 'audio', second: 'render', expected: 'audio' },
]

const failureOrderMatrix = failureOrderCases.flatMap((testCase) => [
  { ...testCase, timing: 'same turn' as const },
  { ...testCase, timing: 'one microtask apart' as const },
])

describe('runPipelinedFrameLoop', () => {
  it.each(failureOrderMatrix)(
    'preserves source order: $name ($timing)',
    async ({ first, second, expected, timing }) => {
      const controller = new AbortController()
      const render = deferred()
      const encode = deferred()
      const audio = deferred()
      const errors: Record<FailureSource, unknown> = {
        render: new Error('render source failed'),
        encode: new Error('encode source failed'),
        audio: new Error('audio source failed'),
        abort: null,
      }
      const cleanupError = new Error('abort cleanup must not mask the primary failure')
      const failureState = createPipelinedFrameLoopFailureState()
      const observedAudio = audio.promise.then(
        () => undefined,
        (error: unknown) => failureState.reportFailure(error),
      )
      const unhandledRejections: unknown[] = []
      const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
      process.on('unhandledRejection', onUnhandledRejection)

      let renderSettled = false
      let encodeSettled = false
      let audioSettled = false
      let outcome: Promise<unknown> | undefined

      const fire = (source: FailureSource) => {
        switch (source) {
          case 'render':
            renderSettled = true
            render.reject(errors.render)
            break
          case 'encode':
            encodeSettled = true
            encode.reject(errors.encode)
            break
          case 'audio':
            audioSettled = true
            audio.reject(errors.audio)
            break
          case 'abort':
            controller.abort()
            break
        }
      }

      try {
        const { events, samples, run } = createHarness(2, {
          signal: controller.signal,
          failureState,
          renderImpl: (frame) => (frame === 1 ? render.promise : undefined),
          encodeImpl: () => encode.promise,
          onAbortImpl: () => {
            throw cleanupError
          },
        })

        outcome = run().then(
          () => null,
          (error: unknown) => error,
        )
        await tick()
        expect(events).toContain('render-1')

        // Calls earlier in this list define same-turn ties. Promise reactions
        // and the queued abort publication retain that source enqueue order.
        fire(first)
        if (timing === 'one microtask apart') await Promise.resolve()
        fire(second)

        if (!renderSettled) render.resolve()
        if (!encodeSettled) encode.resolve()
        if (!audioSettled) audio.resolve()

        const error = await outcome
        if (expected === 'abort') {
          expect(error).toBeInstanceOf(DOMException)
          expect((error as DOMException).name).toBe('AbortError')
        } else {
          expect(error).toBe(errors[expected])
        }

        await observedAudio
        await tick()
        expect(unhandledRejections).toEqual([])
        expect(samples).toHaveLength(1)
        expect(samples[0]?.closed).toBe(true)
        expect(events).toContain('close-0')
        expect(events.includes('abort-cancel')).toBe(controller.signal.aborted)
        if (controller.signal.aborted) {
          expect(indexOf(events, 'close-0')).toBeLessThan(indexOf(events, 'abort-cancel'))
        }
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
      } finally {
        controller.abort()
        render.resolve()
        encode.resolve()
        audio.resolve()
        await observedAudio
        await outcome
        removeListener.mockRestore()
        process.off('unhandledRejection', onUnhandledRejection)
      }
    },
  )

  it('preserves a render rejection boundary over queued encode-success cleanup', async () => {
    const renderError = new Error('render source rejected first')
    const closeError = new Error('sample close ran before the render observer')
    let closeCount = 0
    const sample: FakeSample = {
      frame: 0,
      closed: false,
      close() {
        closeCount++
        this.closed = true
        throw closeError
      },
    }

    const outcome = runPipelinedFrameLoop({
      totalFrames: 2,
      renderFrame: (frame, reportFailure) => {
        if (frame === 0) return Promise.resolve()

        // The encode-success continuation is already queued, so it will run
        // sample.close() before this rejection observer. The render rejection
        // is nevertheless a primary source boundary and must own the result.
        const rendering = Promise.reject(renderError)
        void rendering.catch(reportFailure)
        return rendering
      },
      captureSample: () => sample,
      encodeSample: (_sample, _keyFrame, reportFailure) => {
        const encoding = Promise.resolve()
        void encoding.catch(reportFailure)
        return encoding
      },
      onAbort: () => Promise.resolve(),
      onFrameProgress: () => undefined,
    }).then(
      () => null,
      (error: unknown) => error,
    )

    const error = await outcome
    expect(error).toBe(renderError)
    expect(closeCount).toBe(1)
  })

  it('preserves an abort boundary over a later synchronous render throw', async () => {
    const controller = new AbortController()
    const renderError = new Error('render threw after abort')
    const onAbort = vi.fn(() => Promise.resolve())

    const error = await runPipelinedFrameLoop({
      totalFrames: 1,
      signal: controller.signal,
      renderFrame: () => {
        controller.abort()
        throw renderError
      },
      captureSample: () => {
        throw new Error('capture must not run')
      },
      encodeSample: () => Promise.resolve(),
      onAbort,
      onFrameProgress: () => undefined,
    }).then(
      () => null,
      (failure: unknown) => failure,
    )

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(onAbort).toHaveBeenCalledOnce()
  })

  it('lets an already-queued render rejection observer beat a later abort publication', async () => {
    const controller = new AbortController()
    const renderError = new Error('render rejected before abort')

    const error = await runPipelinedFrameLoop({
      totalFrames: 1,
      signal: controller.signal,
      renderFrame: (_frame, reportFailure) => {
        const rendering = Promise.reject(renderError)
        void rendering.catch(reportFailure)
        controller.abort()
        return rendering
      },
      captureSample: () => {
        throw new Error('capture must not run')
      },
      encodeSample: () => Promise.resolve(),
      onAbort: () => Promise.resolve(),
      onFrameProgress: () => undefined,
    }).then(
      () => null,
      (failure: unknown) => failure,
    )

    expect(error).toBe(renderError)
  })

  it('preserves an established primary when listener removal throws', async () => {
    const controller = new AbortController()
    const renderError = new Error('primary render failure')
    const listenerError = new Error('listener removal failed')
    const removeListener = vi
      .spyOn(controller.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw listenerError
      })

    try {
      const { run } = createHarness(1, {
        signal: controller.signal,
        renderImpl: () => {
          throw renderError
        },
      })

      await expect(run()).rejects.toBe(renderError)
      expect(removeListener).toHaveBeenCalledOnce()
    } finally {
      removeListener.mockRestore()
    }
  })

  it('surfaces listener-removal failure when there is no primary failure', async () => {
    const controller = new AbortController()
    const listenerError = new Error('listener removal failed')
    const removeListener = vi
      .spyOn(controller.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw listenerError
      })

    try {
      const { run } = createHarness(1, { signal: controller.signal })

      await expect(run()).rejects.toBe(listenerError)
      expect(removeListener).toHaveBeenCalledOnce()
    } finally {
      removeListener.mockRestore()
    }
  })

  it('encodes all frames in order and closes every sample', async () => {
    const { events, samples, run } = createHarness(5)
    await run()

    const starts = events.filter((e) => e.startsWith('encode-start-'))
    expect(starts).toEqual([
      'encode-start-0-key',
      'encode-start-1',
      'encode-start-2',
      'encode-start-3',
      'encode-start-4',
    ])
    expect(samples).toHaveLength(5)
    expect(samples.every((sample) => sample.closed)).toBe(true)
  })

  it('marks only frame 0 as a keyframe', async () => {
    const { events, run } = createHarness(3)
    await run()
    expect(events.filter((e) => e.includes('-key'))).toEqual(['encode-start-0-key'])
  })

  it('overlaps the next render with the in-flight encode', async () => {
    const encodes: Deferred[] = []
    const { events, run } = createHarness(3, {
      encodeImpl: () => {
        const d = deferred()
        encodes.push(d)
        return d.promise
      },
    })

    const running = run()
    await tick()
    // Encode 0 has not finished, yet render 1 already started — the overlap.
    expect(events).toContain('render-1')
    expect(events).not.toContain('encode-end-0')

    // But capture 1 must wait for encode 0 to drain.
    expect(events).not.toContain('capture-1')

    for (let i = 0; i < 3; i++) {
      encodes[i]?.resolve()
      await tick()
    }
    await running
    expect(events.filter((e) => e.startsWith('encode-end-'))).toHaveLength(3)
  })

  it('keeps at most one encode in flight: capture N waits for encode N-1', async () => {
    const { events, run } = createHarness(4)
    await run()

    for (let frame = 1; frame < 4; frame++) {
      const previousEncodeEnd = indexOf(events, `encode-end-${frame - 1}`)
      const capture = indexOf(events, `capture-${frame}`)
      const encodeStart = indexOf(events, `encode-start-${frame}`)
      expect(previousEncodeEnd).toBeLessThan(capture)
      expect(capture).toBeLessThan(encodeStart)
    }
  })

  it('reports progress once per frame, synchronously after the encode is kicked off', async () => {
    const { events, run } = createHarness(3)
    await run()

    for (let frame = 0; frame < 3; frame++) {
      expect(events.filter((e) => e === `progress-${frame}`)).toHaveLength(1)
      const encodeStart = events.findIndex((e) => e.startsWith(`encode-start-${frame}`))
      const progress = indexOf(events, `progress-${frame}`)
      expect(encodeStart).toBeLessThan(progress)
      // Progress fires before the encode settles — the encode is unawaited.
      expect(progress).toBeLessThan(indexOf(events, `encode-end-${frame}`))
    }
  })

  it('closes the sample and propagates the error when the encoder throws', async () => {
    const encoderError = new Error('encoder exploded')
    const { events, samples, run } = createHarness(4, {
      encodeImpl: (sample) =>
        sample.frame === 1 ? Promise.reject(encoderError) : Promise.resolve(),
    })

    await expect(run()).rejects.toBe(encoderError)
    // The failing encode was kicked off unawaited, so the next render still
    // overlapped it; the error surfaced at the drain point, before capture.
    expect(events).toContain('render-2')
    expect(events).not.toContain('capture-2')
    expect(samples[1]?.closed).toBe(true)
  })

  it('observes an immediate encode rejection while the next render stays pending', async () => {
    const encoderError = new Error('encoder rejected immediately')
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const { events, samples, run } = createHarness(2, {
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: (sample) =>
          sample.frame === 0 ? Promise.reject(encoderError) : Promise.resolve(),
      })

      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      await tick()

      expect(events).toContain('render-1')
      expect(unhandledRejections).toEqual([])

      nextRender.resolve()
      expect(await outcome).toBe(encoderError)
      expect(samples[0]?.closed).toBe(true)
    } finally {
      nextRender.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves an earlier audio error when video rejects during a pending render', async () => {
    const audioError = new Error('audio task failed first')
    const encoderError = new Error('video encoder failed later')
    const encode = deferred()
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const { events, samples, failureState, run } = createHarness(2, {
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: () => encode.promise,
      })

      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      expect(events).toContain('render-1')

      failureState.reportFailure(audioError)
      encode.reject(encoderError)
      await tick()
      expect(unhandledRejections).toEqual([])

      nextRender.resolve()
      expect(await outcome).toBe(audioError)
      expect(samples[0]?.closed).toBe(true)
    } finally {
      nextRender.resolve()
      encode.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves earlier audio over abort and a rejecting render before encode drains', async () => {
    const controller = new AbortController()
    const audioError = new Error('audio task failed first')
    const renderError = new Error('render failed later')
    const cleanupError = new Error('sample cleanup failed last')
    const encode = deferred()
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const { events, samples, failureState, run } = createHarness(2, {
        signal: controller.signal,
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: () => encode.promise,
        closeImpl: () => {
          throw cleanupError
        },
      })

      let settled = false
      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      void outcome.finally(() => {
        settled = true
      })
      await tick()
      expect(events).toContain('render-1')

      failureState.reportFailure(audioError)
      controller.abort()
      nextRender.reject(renderError)
      await tick()
      expect(settled).toBe(false)
      expect(unhandledRejections).toEqual([])

      encode.resolve()
      expect(await outcome).toBe(audioError)
      expect(events).toContain('abort-cancel')
      expect(samples[0]?.closed).toBe(true)
      await tick()
      expect(unhandledRejections).toEqual([])
    } finally {
      controller.abort()
      nextRender.resolve()
      encode.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves the video error when sample cleanup and rendering fail later', async () => {
    const encoderError = new Error('video encoder failed first')
    const cleanupError = new Error('sample cleanup failed later')
    const renderError = new Error('render failed last')
    const encode = deferred()
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const { events, samples, run } = createHarness(2, {
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: () => encode.promise,
        closeImpl: () => {
          throw cleanupError
        },
      })

      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      expect(events).toContain('render-1')

      encode.reject(encoderError)
      await tick()
      nextRender.reject(renderError)

      expect(await outcome).toBe(encoderError)
      await tick()
      expect(unhandledRejections).toEqual([])
      expect(samples[0]?.closed).toBe(true)
    } finally {
      encode.resolve()
      nextRender.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves a render error while observing a late encoder rejection', async () => {
    const renderError = new Error('render failed')
    const encoderError = new Error('encoder failed after render')
    const encode = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const { events, samples, run } = createHarness(3, {
        renderImpl: (frame) => {
          if (frame === 1) throw renderError
        },
        encodeImpl: () => encode.promise,
      })

      const outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      expect(events).toContain('render-1')

      encode.reject(encoderError)
      expect(await outcome).toBe(renderError)
      await tick()
      expect(unhandledRejections).toEqual([])
      expect(samples[0]?.closed).toBe(true)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves a pending error while observing a late encoder rejection', async () => {
    const pendingError = new Error('audio task failed')
    const encoderError = new Error('encoder failed after pending error')
    const encodes: Deferred[] = []
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    const failureState = createPipelinedFrameLoopFailureState()

    try {
      const { events, samples, run } = createHarness(4, {
        failureState,
        renderImpl: (frame) => {
          if (frame === 1) failureState.reportFailure(pendingError)
        },
        encodeImpl: () => {
          const encode = deferred()
          encodes.push(encode)
          return encode.promise
        },
      })

      const outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      expect(events).toContain('render-1')
      encodes[0]?.resolve()
      await tick()
      expect(events).toContain('encode-start-1')

      encodes[1]?.reject(encoderError)
      expect(await outcome).toBe(pendingError)
      await tick()
      expect(unhandledRejections).toEqual([])
      expect(samples[1]?.closed).toBe(true)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('honours an abort signalled before the loop starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const { events, run } = createHarness(5, { signal: controller.signal })

    const error = await run().then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect((error as DOMException).message).toBe('Render cancelled')
    expect(events).toEqual(['abort-cancel'])
  })

  it('drains the in-flight encode on abort, swallowing its rejection', async () => {
    const controller = new AbortController()
    const encodes: Deferred[] = []
    const { events, samples, run } = createHarness(5, {
      signal: controller.signal,
      renderImpl: (frame) => {
        if (frame === 1) controller.abort()
      },
      encodeImpl: () => {
        const d = deferred()
        encodes.push(d)
        return d.promise
      },
    })

    const running = run()
    const outcome = running.then(
      () => null,
      (e: unknown) => e,
    )
    await tick()
    encodes[0]?.resolve()
    await tick()
    // Frame 1 was captured before the abort could be observed (abort is only
    // checked at the top of each iteration), and its encode is now in flight.
    expect(events).toContain('capture-1')

    // The in-flight encode fails during the abort drain — the loop must still
    // surface AbortError, not the encoder error.
    encodes[1]?.reject(new Error('encoder died mid-abort'))
    const error = await outcome
    expect((error as DOMException).name).toBe('AbortError')
    expect(events).toContain('abort-cancel')
    expect(indexOf(events, 'abort-cancel')).toBeGreaterThan(indexOf(events, 'capture-1'))
    expect(samples[1]?.closed).toBe(true)
    expect(events).not.toContain('render-2')
    expect(events).not.toContain('capture-2')
  })

  it('observes and drains a pending encode when abort wins during rendering', async () => {
    const controller = new AbortController()
    const encoderError = new Error('encoder failed after abort')
    const encode = deferred()
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const { events, samples, run } = createHarness(2, {
        signal: controller.signal,
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: () => encode.promise,
      })

      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      await tick()
      expect(events).toContain('render-1')

      controller.abort()
      encode.reject(encoderError)
      await tick()
      expect(unhandledRejections).toEqual([])

      nextRender.resolve()
      const error = await outcome
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
      expect(events).toContain('abort-cancel')
      expect(samples[0]?.closed).toBe(true)
    } finally {
      controller.abort()
      encode.resolve()
      nextRender.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('preserves earlier abort over audio and a rejecting render before encode drains', async () => {
    const controller = new AbortController()
    const audioError = new Error('audio task failed later')
    const renderError = new Error('render failed later')
    const abortCleanupError = new Error('abort cleanup failed last')
    const encode = deferred()
    const nextRender = deferred()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    let outcome: Promise<unknown> | undefined

    try {
      const audio = deferred()
      const failureState = createPipelinedFrameLoopFailureState()
      const observedAudio = audio.promise.catch((error: unknown) => {
        failureState.reportFailure(error)
      })
      const { events, samples, run } = createHarness(2, {
        signal: controller.signal,
        failureState,
        renderImpl: (frame) => (frame === 1 ? nextRender.promise : undefined),
        encodeImpl: () => encode.promise,
        onAbortImpl: () => {
          throw abortCleanupError
        },
      })

      let settled = false
      outcome = run().then(
        () => null,
        (error: unknown) => error,
      )
      void outcome.finally(() => {
        settled = true
      })
      await tick()
      expect(events).toContain('render-1')

      controller.abort()
      audio.reject(audioError)
      nextRender.reject(renderError)
      await tick()
      expect(settled).toBe(false)
      expect(unhandledRejections).toEqual([])

      encode.resolve()
      const error = await outcome
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
      expect(events).toContain('abort-cancel')
      expect(samples[0]?.closed).toBe(true)
      await observedAudio
      await tick()
      expect(unhandledRejections).toEqual([])
    } finally {
      controller.abort()
      nextRender.resolve()
      encode.resolve()
      await outcome
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('throws a pending error at the top of the next iteration', async () => {
    const pendingError = new Error('audio task failed')
    const failureState = createPipelinedFrameLoopFailureState()
    const { events, run } = createHarness(5, {
      failureState,
      renderImpl: (frame) => {
        if (frame === 1) failureState.reportFailure(pendingError)
      },
    })

    await expect(run()).rejects.toBe(pendingError)
    expect(events).toContain('progress-1')
    expect(events).not.toContain('render-2')
  })

  it('continues until an external source publishes a failure', async () => {
    const { samples, run } = createHarness(2)
    await run()
    expect(samples).toHaveLength(2)
  })

  it('resolves immediately for zero frames without touching any callback', async () => {
    const controller = new AbortController()
    controller.abort()
    const failureState = createPipelinedFrameLoopFailureState()
    failureState.reportFailure(new Error('never checked'))
    const { events, run } = createHarness(0, {
      signal: controller.signal,
      failureState,
    })
    await run()
    // Pre-loop abort/error checks are the caller's responsibility.
    expect(events).toEqual([])
  })

  it('drains the final in-flight encode before resolving', async () => {
    const lastEncode = deferred()
    const { samples, run } = createHarness(1, { encodeImpl: () => lastEncode.promise })

    let settled = false
    const running = run().then(() => {
      settled = true
    })
    await tick()
    expect(settled).toBe(false)

    lastEncode.resolve()
    await running
    expect(settled).toBe(true)
    expect(samples[0]?.closed).toBe(true)
  })
})
