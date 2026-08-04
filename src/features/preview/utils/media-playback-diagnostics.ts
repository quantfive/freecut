interface MediaPlaybackDiagnosticSnapshot {
  durationMs: number
  rafFps: number
  presentedFps: number
  callbackFps: number
  rafTicks: number
  presentedFrames: number
  callbackFrames: number
  mediaAdvanceSeconds: number
  droppedFrames: number | null
  totalVideoFrames: number | null
}

interface VideoPlaybackQualityLike {
  droppedVideoFrames: number
  totalVideoFrames: number
}

type DiagnosticVideo = HTMLVideoElement & {
  getVideoPlaybackQuality?: () => VideoPlaybackQualityLike
}

function perSecond(intervals: number, durationMs: number): number {
  return durationMs > 0 ? (intervals * 1000) / durationMs : 0
}

function elapsedBetween(firstMs: number | null, lastMs: number | null): number {
  return firstMs === null || lastMs === null ? 0 : Math.max(0, lastMs - firstMs)
}

function qualityDelta(
  quality: VideoPlaybackQualityLike | undefined,
  initialValue: number | null,
  select: (value: VideoPlaybackQualityLike) => number,
): number | null {
  return quality && initialValue !== null ? Math.max(0, select(quality) - initialValue) : null
}

function displayedFrameCount(totalFrames: number | null, droppedFrames: number | null) {
  return totalFrames === null || droppedFrames === null
    ? null
    : Math.max(0, totalFrames - droppedFrames)
}

function mediaAdvance(firstMediaTime: number | null, lastMediaTime: number | null): number {
  return firstMediaTime === null || lastMediaTime === null
    ? 0
    : Math.max(0, lastMediaTime - firstMediaTime)
}

function publishMediaPlaybackDiagnostics(
  video: HTMLVideoElement,
  snapshot: MediaPlaybackDiagnosticSnapshot,
): void {
  video.dataset.sourcePlaybackDurationMs = snapshot.durationMs.toFixed(1)
  video.dataset.sourcePlaybackRafFps = snapshot.rafFps.toFixed(1)
  video.dataset.sourcePlaybackPresentedFps = snapshot.presentedFps.toFixed(1)
  video.dataset.sourcePlaybackCallbackFps = snapshot.callbackFps.toFixed(1)
  video.dataset.sourcePlaybackRafTicks = String(snapshot.rafTicks)
  video.dataset.sourcePlaybackPresentedFrames = String(snapshot.presentedFrames)
  video.dataset.sourcePlaybackCallbackFrames = String(snapshot.callbackFrames)
  video.dataset.sourcePlaybackMediaAdvanceSeconds = snapshot.mediaAdvanceSeconds.toFixed(3)
  video.dataset.sourcePlaybackDroppedFrames =
    snapshot.droppedFrames === null ? 'unavailable' : String(snapshot.droppedFrames)
  video.dataset.sourcePlaybackTotalVideoFrames =
    snapshot.totalVideoFrames === null ? 'unavailable' : String(snapshot.totalVideoFrames)
}

/**
 * Measures what the browser actually presents for a playing media element.
 * Clock/rAF cadence alone can stay at 60 Hz while a high-resolution decoder
 * produces far fewer frames, so keep both counters visible to live tests.
 */
export function observeMediaPlaybackDiagnostics(video: HTMLVideoElement): () => void {
  const startedAtMs = performance.now()
  const initialQuality = (video as DiagnosticVideo).getVideoPlaybackQuality?.()
  const initialDroppedFrames = initialQuality?.droppedVideoFrames ?? null
  const initialTotalVideoFrames = initialQuality?.totalVideoFrames ?? null
  let stopped = false
  let rafHandle = 0
  let videoFrameHandle = 0
  let rafTicks = 0
  let callbackFrames = 0
  let firstRafAtMs: number | null = null
  let lastRafAtMs: number | null = null
  let firstPresentationAtMs: number | null = null
  let lastPresentationAtMs: number | null = null
  let firstPresentedFrameNumber: number | null = null
  let lastPresentedFrameNumber: number | null = null
  let firstMediaTime: number | null = null
  let lastMediaTime: number | null = null

  const snapshot = (nowMs: number): MediaPlaybackDiagnosticSnapshot => {
    const quality = (video as DiagnosticVideo).getVideoPlaybackQuality?.()
    const rafDurationMs = elapsedBetween(firstRafAtMs, lastRafAtMs)
    const presentationDurationMs = elapsedBetween(firstPresentationAtMs, lastPresentationAtMs)
    const droppedFrames = qualityDelta(
      quality,
      initialDroppedFrames,
      (value) => value.droppedVideoFrames,
    )
    const totalVideoFrames = qualityDelta(
      quality,
      initialTotalVideoFrames,
      (value) => value.totalVideoFrames,
    )
    const displayedFrames = displayedFrameCount(totalVideoFrames, droppedFrames)
    const callbackFps = perSecond(Math.max(0, callbackFrames - 1), presentationDurationMs)
    return {
      durationMs: Math.max(0, nowMs - startedAtMs),
      rafFps: perSecond(Math.max(0, rafTicks - 1), rafDurationMs),
      presentedFps:
        displayedFrames === null
          ? callbackFps
          : perSecond(displayedFrames, Math.max(0, nowMs - startedAtMs)),
      callbackFps,
      rafTicks,
      presentedFrames: displayedFrames ?? callbackFrames,
      callbackFrames,
      mediaAdvanceSeconds: mediaAdvance(firstMediaTime, lastMediaTime),
      droppedFrames,
      totalVideoFrames,
    }
  }

  const report = (nowMs: number) => {
    publishMediaPlaybackDiagnostics(video, snapshot(nowMs))
  }

  const onRaf = (nowMs: number) => {
    if (stopped) return
    firstRafAtMs ??= nowMs
    lastRafAtMs = nowMs
    rafTicks += 1
    if (rafTicks % 15 === 0) report(nowMs)
    rafHandle = requestAnimationFrame(onRaf)
  }

  const onVideoFrame: VideoFrameRequestCallback = (nowMs, metadata) => {
    if (stopped) return
    firstPresentationAtMs ??= nowMs
    lastPresentationAtMs = nowMs
    firstPresentedFrameNumber ??= metadata.presentedFrames
    lastPresentedFrameNumber = metadata.presentedFrames
    firstMediaTime ??= metadata.mediaTime
    lastMediaTime = metadata.mediaTime
    callbackFrames =
      firstPresentedFrameNumber === null || lastPresentedFrameNumber === null
        ? 0
        : Math.max(1, lastPresentedFrameNumber - firstPresentedFrameNumber + 1)
    videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame)
  }

  video.dataset.sourcePlaybackDiagnostics = 'active'
  rafHandle = requestAnimationFrame(onRaf)
  if (typeof video.requestVideoFrameCallback === 'function') {
    videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame)
  }

  return () => {
    stopped = true
    cancelAnimationFrame(rafHandle)
    if (videoFrameHandle !== 0) video.cancelVideoFrameCallback?.(videoFrameHandle)
    video.dataset.sourcePlaybackDiagnostics = 'complete'
    report(performance.now())
  }
}
