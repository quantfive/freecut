export interface FrameRenderOptimizationInput {
  activeMaskCount: number
  activeTransitionCount: number
  hasGpuEffects: boolean
  renderTaskCount: number
}

export interface FrameRenderOptimization {
  shouldDirectRenderSingleTask: boolean
  shouldUseDeferredGpuBatch: boolean
}

/**
 * The scrub cache is optimized for paused random access. A DOM video provider
 * is also installed while paused so the browser can satisfy exact seeks before
 * the worker; that must not disable retention. Only advancing playback bypasses
 * cache reads and writes because its full-frame copies contend with the next
 * presentation.
 */
export function shouldUseScrubbingFrameCache(
  hasScrubbingCache: boolean,
  _liveDomVideoPlaybackActive: boolean,
  liveRenderedPlaybackActive = false,
): boolean {
  return hasScrubbingCache && !liveRenderedPlaybackActive
}

export function resolveFrameRenderOptimization(
  input: FrameRenderOptimizationInput,
): FrameRenderOptimization {
  const shouldDirectRenderSingleTask =
    input.activeMaskCount === 0 &&
    input.activeTransitionCount === 0 &&
    input.renderTaskCount === 1 &&
    !input.hasGpuEffects

  return {
    shouldDirectRenderSingleTask,
    shouldUseDeferredGpuBatch: input.hasGpuEffects && input.renderTaskCount > 0,
  }
}
