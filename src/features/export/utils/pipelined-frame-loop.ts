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

export interface PipelinedFrameLoopDeps<S extends CloseableSample> {
  totalFrames: number
  signal?: AbortSignal
  /**
   * Read (not throw) a pending async error, e.g. a failed audio task.
   * Checked with a truthiness test at the top of every iteration.
   */
  getPendingError?: () => unknown
  /**
   * Render the frame to the capture surface, including any scale-to-output
   * blit. Overlaps with the previous frame's in-flight encode.
   */
  renderFrame: (frame: number) => Promise<void>
  /**
   * Snapshot the capture surface (e.g. VideoSample construction). Called
   * strictly after the previous encode has drained; must stay synchronous.
   */
  captureSample: (frame: number) => S
  /**
   * Feed the sample to the encoder. `keyFrame` is true only for frame 0.
   * The loop closes the sample when the returned promise settles.
   */
  encodeSample: (sample: S, keyFrame: boolean) => Promise<void>
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

interface RecordedFailure {
  error: unknown
}

async function encodeAndCloseSample<S extends CloseableSample>(
  sample: S,
  keyFrame: boolean,
  encodeSample: (sample: S, keyFrame: boolean) => Promise<void>,
  recordSettledFailure: (error: unknown) => void,
): Promise<EncodeSettlement> {
  let failure: RecordedFailure | null = null
  try {
    await encodeSample(sample, keyFrame)
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
    getPendingError,
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
  let firstFailure: RecordedFailure | null = null
  let abortError: DOMException | null = null
  let abortCleanupStarted = false

  const recordFailure = (error: unknown) => {
    firstFailure ??= { error }
  }

  const getAbortError = () => {
    abortError ??= new DOMException('Render cancelled', 'AbortError')
    return abortError
  }

  const recordPendingFailure = (): RecordedFailure | null => {
    try {
      const pendingError = getPendingError?.()
      if (!pendingError) return null
      const failure = { error: pendingError }
      recordFailure(pendingError)
      return failure
    } catch (pendingError) {
      recordFailure(pendingError)
      return { error: pendingError }
    }
  }

  const recordObservableFailures = () => {
    // Sampling pending audio before recording an already-fired abort preserves
    // their event order: the abort listener observes audio that failed first,
    // while an abort already recorded by the listener remains primary over an
    // audio failure that appears later.
    recordPendingFailure()
    if (signal?.aborted) recordFailure(getAbortError())
  }

  const recordSettledFailure = (error: unknown) => {
    // Audio or abort may have happened while renderFrame or this encode was
    // pending. Observe those primary exit conditions before the later encode
    // or sample-cleanup failure.
    recordObservableFailures()
    recordFailure(error)
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
    const failure = firstFailure
    if (!failure) return
    if (signal?.aborted) await runAbortCleanup()
    throw failure.error
  }

  signal?.addEventListener('abort', recordObservableFailures, { once: true })

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const pendingFailure = recordPendingFailure()
      if (pendingFailure) throw pendingFailure.error

      // Check for abort — drain any in-flight encode first so the encoder is
      // idle before we cancel the output. The first recorded failure wins, so
      // this AbortError is preserved over an encoder failure during the drain.
      if (signal?.aborted) {
        recordFailure(getAbortError())
        await drainPendingEncode()
        await throwRecordedFailureAfterDrain()
      }

      // Render frame first — this overlaps with the previous frame's encode
      // that is still in flight. The previous sample already copied its
      // pixels, so writing to the capture surface here cannot corrupt it.
      await renderFrame(frame)

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
      pendingEncode = encodeAndCloseSample(sample, isKeyFrame, encodeSample, recordSettledFailure)

      onFrameProgress(frame)
    }

    // Drain the final in-flight encode before finalizing
    await drainPendingEncode()
    if (totalFrames > 0) recordObservableFailures()
    await throwRecordedFailureAfterDrain()
  } catch (primaryError) {
    // A render/capture/progress rejection reaches this catch on a later promise
    // turn. Sample failures already exposed by the concurrent channels before
    // assigning that newly caught error.
    recordObservableFailures()
    recordFailure(primaryError)
    await drainPendingEncode()
    await throwRecordedFailureAfterDrain()
    throw primaryError
  } finally {
    signal?.removeEventListener('abort', recordObservableFailures)
  }
}
