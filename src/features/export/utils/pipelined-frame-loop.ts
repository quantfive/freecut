/**
 * Pipelined double-buffer frame loop, extracted verbatim from
 * {@link renderComposition} in canvas-render-orchestrator.ts.
 *
 * Renders frame N while frame N-1's encode is still in flight; at most one
 * encode is in flight at a time, and a sample is captured only after the
 * previous encode has drained, so frames reach the encoder in order.
 *
 * Behavior must stay bit-identical to the original inline loop — this is the
 * export hot path. Every exit drains an in-flight encode so its sample closes
 * and its rejection is observed. Failures retain their occurrence order: a
 * render, pending audio, or abort failure that happens first is not replaced
 * by a later encode or cleanup failure, and vice versa.
 */

export interface CloseableSample {
  close(): void
}

interface RecordedFailure {
  error: unknown
}

export interface PipelinedFrameLoopFailureState {
  readonly firstFailure: RecordedFailure | null
  reportFailure(error: unknown): void
}

/**
 * Shared first-error latch for concurrently running export sources.
 *
 * Sources publish when their failure becomes observable. Promise sources must
 * attach their rejection observer immediately; abort publication is queued as
 * a microtask so same-turn promise rejection and abort events are ordered by
 * the source events that queued their observers, not by a synchronous abort
 * listener racing ahead of already-fired promise rejections.
 */
export function createPipelinedFrameLoopFailureState(): PipelinedFrameLoopFailureState {
  let firstFailure: RecordedFailure | null = null
  return {
    get firstFailure() {
      return firstFailure
    },
    reportFailure(error) {
      firstFailure ??= { error }
    },
  }
}

export interface PipelinedFrameLoopDeps<S extends CloseableSample> {
  totalFrames: number
  signal?: AbortSignal
  /**
   * Shared source-event latch. An independently running source such as audio
   * must attach a rejection observer immediately and publish into this state.
   */
  failureState?: PipelinedFrameLoopFailureState
  /**
   * Render the frame to the capture surface, including any scale-to-output
   * blit. Overlaps with the previous frame's in-flight encode. The callback
   * must be invoked by the rejection observer attached directly to the source
   * promise, before rethrowing through any async wrapper.
   */
  renderFrame: (frame: number, reportFailure: (error: unknown) => void) => Promise<void>
  /**
   * Snapshot the capture surface (e.g. VideoSample construction). Called
   * strictly after the previous encode has drained; must stay synchronous.
   */
  captureSample: (frame: number) => S
  /**
   * Feed the sample to the encoder. `keyFrame` is true only for frame 0.
   * The loop closes the sample when the returned promise settles. As with
   * renderFrame, report a rejection from an observer on the source promise.
   */
  encodeSample: (
    sample: S,
    keyFrame: boolean,
    reportFailure: (error: unknown) => void,
  ) => Promise<void>
  /**
   * Abort path: called after the in-flight encode has been drained (its
   * errors observed), before the selected failure is thrown.
   */
  onAbort: () => Promise<void>
  /** Called once per frame, synchronously after its encode is kicked off. */
  onFrameProgress: (frame: number) => void
}

interface EncodeSettlement {
  status: 'fulfilled' | 'rejected'
  reason?: unknown
}

async function encodeAndCloseSample<S extends CloseableSample>(
  sample: S,
  keyFrame: boolean,
  encodeSample: (
    sample: S,
    keyFrame: boolean,
    reportFailure: (error: unknown) => void,
  ) => Promise<void>,
  recordSettledFailure: (error: unknown) => void,
): Promise<EncodeSettlement> {
  let failure: RecordedFailure | null = null
  try {
    await encodeSample(sample, keyFrame, recordSettledFailure)
  } catch (error) {
    failure = { error }
    recordSettledFailure(error)
  }

  try {
    // The encoder does NOT close samples. We must close to release the
    // underlying frame's GPU memory, otherwise the browser throttles after
    // ~8-16 outstanding frames.
    sample.close()
  } catch (error) {
    // If encoding already failed, it happened before cleanup and remains the
    // failure represented by this settlement.
    if (!failure) {
      failure = { error }
      recordSettledFailure(error)
    }
  }

  return failure ? { status: 'rejected', reason: failure.error } : { status: 'fulfilled' }
}

export async function runPipelinedFrameLoop<S extends CloseableSample>(
  deps: PipelinedFrameLoopDeps<S>,
): Promise<void> {
  const {
    totalFrames,
    signal,
    failureState = createPipelinedFrameLoopFailureState(),
    renderFrame,
    captureSample,
    encodeSample,
    onAbort,
    onFrameProgress,
  } = deps

  // The promise stored here never rejects. Encode and sample-cleanup failures
  // are reflected into a settlement immediately, so an encoder rejection is
  // observed even while renderFrame remains pending for another event turn.
  let pendingEncode: Promise<EncodeSettlement> | null = null
  let abortError: DOMException | null = null
  let abortCleanupStarted = false
  let abortPublicationQueued = false
  let listenerActive = true

  const recordFailure = (error: unknown) => {
    failureState.reportFailure(error)
  }

  const getAbortError = () => {
    abortError ??= new DOMException('Render cancelled', 'AbortError')
    return abortError
  }

  const publishAbort = () => {
    if (abortPublicationQueued) return
    abortPublicationQueued = true
    queueMicrotask(() => {
      if (listenerActive) recordFailure(getAbortError())
    })
  }

  const drainPendingEncode = async (): Promise<EncodeSettlement | null> => {
    if (!pendingEncode) return null
    const encode = pendingEncode
    try {
      return await encode
    } finally {
      pendingEncode = null
    }
  }

  const runAbortCleanup = async () => {
    if (abortCleanupStarted) return
    abortCleanupStarted = true
    try {
      await onAbort()
    } catch (error) {
      recordFailure(error)
    }
  }

  const throwRecordedFailureAfterDrain = async () => {
    const failure = failureState.firstFailure
    if (!failure) return
    if (signal?.aborted) await runAbortCleanup()
    throw failure.error
  }

  signal?.addEventListener('abort', publishAbort, { once: true })

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const pendingFailure = failureState.firstFailure
      if (pendingFailure) throw pendingFailure.error

      // Check for abort — drain any in-flight encode first so the encoder is
      // idle before we cancel the output. The first recorded failure wins, so
      // this AbortError is preserved over an encoder failure during the drain.
      if (signal?.aborted) {
        publishAbort()
        // Let reactions queued by source failures that fired before abort run
        // before the queued abort publication. If abort fired first, its
        // publication was queued first and remains primary.
        await Promise.resolve()
        await drainPendingEncode()
        await throwRecordedFailureAfterDrain()
      }

      // Render frame first — this overlaps with the previous frame's encode
      // that is still in flight. The previous sample already copied its
      // pixels, so writing to the capture surface here cannot corrupt it.
      await renderFrame(frame, recordFailure)

      // Now wait for the previous encode to finish before capturing a new
      // sample. This ensures at most one encode is in flight and that frames
      // are fed to the encoder in order.
      const previousEncode = await drainPendingEncode()
      if (previousEncode?.status === 'rejected') await throwRecordedFailureAfterDrain()

      // Snapshot pixels into a sample. The capture copies pixel data
      // immediately — the surface is free for the next render.
      const sample = captureSample(frame)

      // Kick off encoding in the background. NOT awaited here — it runs
      // concurrently with the next iteration's renderFrame().
      const isKeyFrame = frame === 0
      pendingEncode = encodeAndCloseSample(sample, isKeyFrame, encodeSample, recordFailure)

      onFrameProgress(frame)
    }

    // Drain the final in-flight encode before finalizing
    await drainPendingEncode()
    if (totalFrames > 0) await throwRecordedFailureAfterDrain()
  } catch (primaryError) {
    recordFailure(primaryError)
    await drainPendingEncode()
    await throwRecordedFailureAfterDrain()
    throw primaryError
  } finally {
    listenerActive = false
    signal?.removeEventListener('abort', publishAbort)
  }
}
