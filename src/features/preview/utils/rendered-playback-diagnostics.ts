export interface RenderedPlaybackDiagnosticSnapshot {
  durationMs: number
  rafFps: number
  clockFps: number
  presentedFps: number
  rafTicks: number
  clockFrames: number
  presentedFrames: number
  renderCount: number
  p50RenderMs: number
  p95RenderMs: number
  maxRenderMs: number
}

export interface RenderedPlaybackDiagnostics {
  start: (nowMs: number) => void
  stop: (nowMs: number) => void
  recordRaf: (nowMs: number) => void
  recordClockFrame: () => void
  recordRender: (renderMs: number) => void
  recordPresentation: (frame: number) => void
  snapshot: () => RenderedPlaybackDiagnosticSnapshot
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

function perSecond(count: number, durationMs: number): number {
  return durationMs > 0 ? (count * 1000) / durationMs : 0
}

export function createRenderedPlaybackDiagnostics(): RenderedPlaybackDiagnostics {
  let active = false
  let startedAtMs = 0
  let stoppedAtMs = 0
  let firstRafAtMs: number | null = null
  let lastRafAtMs: number | null = null
  let rafTicks = 0
  let clockFrames = 0
  const presentedFrames = new Set<number>()
  const renderTimes: number[] = []

  const reset = (nowMs: number) => {
    active = true
    startedAtMs = nowMs
    stoppedAtMs = nowMs
    firstRafAtMs = null
    lastRafAtMs = null
    rafTicks = 0
    clockFrames = 0
    presentedFrames.clear()
    renderTimes.length = 0
  }

  return {
    start: reset,
    stop(nowMs) {
      if (!active) return
      stoppedAtMs = nowMs
      active = false
    },
    recordRaf(nowMs) {
      if (!active) return
      firstRafAtMs ??= nowMs
      lastRafAtMs = nowMs
      stoppedAtMs = nowMs
      rafTicks += 1
    },
    recordClockFrame() {
      if (active) clockFrames += 1
    },
    recordRender(renderMs) {
      if (active) renderTimes.push(renderMs)
    },
    recordPresentation(frame) {
      if (active) presentedFrames.add(frame)
    },
    snapshot() {
      const durationMs = Math.max(0, stoppedAtMs - startedAtMs)
      const rafDurationMs =
        firstRafAtMs === null || lastRafAtMs === null
          ? 0
          : Math.max(0, lastRafAtMs - firstRafAtMs)
      const rafIntervals = Math.max(0, rafTicks - 1)
      return {
        durationMs,
        rafFps: perSecond(rafIntervals, rafDurationMs),
        clockFps: perSecond(clockFrames, durationMs),
        presentedFps: perSecond(presentedFrames.size, durationMs),
        rafTicks,
        clockFrames,
        presentedFrames: presentedFrames.size,
        renderCount: renderTimes.length,
        p50RenderMs: percentile(renderTimes, 0.5),
        p95RenderMs: percentile(renderTimes, 0.95),
        maxRenderMs: Math.max(0, ...renderTimes),
      }
    },
  }
}

export function publishRenderedPlaybackDiagnostics(
  canvas: HTMLCanvasElement | null,
  snapshot: RenderedPlaybackDiagnosticSnapshot,
): void {
  if (!canvas) return
  canvas.dataset.renderedPlaybackDurationMs = snapshot.durationMs.toFixed(1)
  canvas.dataset.renderedPlaybackRafFps = snapshot.rafFps.toFixed(1)
  canvas.dataset.renderedPlaybackClockFps = snapshot.clockFps.toFixed(1)
  canvas.dataset.renderedPlaybackPresentedFps = snapshot.presentedFps.toFixed(1)
  canvas.dataset.renderedPlaybackRafTicks = String(snapshot.rafTicks)
  canvas.dataset.renderedPlaybackClockFrames = String(snapshot.clockFrames)
  canvas.dataset.renderedPlaybackPresentedFrames = String(snapshot.presentedFrames)
  canvas.dataset.renderedPlaybackRenderCount = String(snapshot.renderCount)
  canvas.dataset.renderedPlaybackP50RenderMs = snapshot.p50RenderMs.toFixed(3)
  canvas.dataset.renderedPlaybackP95RenderMs = snapshot.p95RenderMs.toFixed(3)
  canvas.dataset.renderedPlaybackMaxRenderMs = snapshot.maxRenderMs.toFixed(3)
}
