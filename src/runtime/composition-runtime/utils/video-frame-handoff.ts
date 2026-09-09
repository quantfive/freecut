// A Clock belongs to one Player. Keep only its last presented image per track,
// never the arbitrary old bitmap on an incoming recycled video element.
const frames = new WeakMap<object, Map<string, HTMLCanvasElement>>()

export function createVideoFrameHandoff(
  video: HTMLVideoElement,
  container: HTMLElement,
  owner: object,
  trackId: string,
  tolerance: number,
) {
  let visible = false
  let disposed = false
  let lastPresented: number | null = null
  let target = 0
  let generation = 0
  let callback: number | null = null
  let raf: number | null = null
  let overlay: HTMLCanvasElement | null = null
  const originalOpacity = video.style.opacity
  const cache = frames.get(owner) ?? new Map<string, HTMLCanvasElement>()
  frames.set(owner, cache)

  const capture = () => {
    if (!visible || video.seeking || video.readyState < 2 || !video.videoWidth) return
    if (getComputedStyle(video).visibility === 'hidden') return
    const canvas = cache.get(trackId) ?? document.createElement('canvas')
    canvas.width = Math.min(video.videoWidth, 1280)
    canvas.height = Math.max(1, Math.round((canvas.width * video.videoHeight) / video.videoWidth))
    try {
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      cache.set(trackId, canvas)
    } catch {
      // A protected/undecodable source cannot supply a held image.
    }
  }
  const removeOverlay = () => {
    overlay?.remove()
    overlay = null
  }
  const cancel = () => {
    if (callback !== null) video.cancelVideoFrameCallback(callback)
    if (raf !== null) cancelAnimationFrame(raf)
    callback = null
    raf = null
  }
  const reveal = (mediaTime: number, epoch: number) => {
    if (disposed || epoch !== generation || video.seeking || video.readyState < 2) return false
    // currentTime alone is not presentation proof; compare it with the actual
    // decoded timestamp. Allow frames advanced past the seek target during play.
    if (Math.abs(mediaTime - video.currentTime) > tolerance) return false
    if (Math.abs(mediaTime - target) > tolerance && (video.paused || mediaTime < target))
      return false
    visible = true
    video.style.opacity = originalOpacity
    removeOverlay()
    return true
  }
  const awaitFrame = () => {
    const epoch = generation
    if (typeof video.requestVideoFrameCallback === 'function') {
      callback = video.requestVideoFrameCallback((_now, metadata) => {
        callback = null
        if (disposed || epoch !== generation) return
        lastPresented = metadata.mediaTime
        reveal(metadata.mediaTime, epoch)
        awaitFrame()
      })
    }
  }
  // Older engines without rVFC only release after a settled seek and a paint.
  const settled = () => {
    if (visible || video.seeking) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      if (lastPresented !== null) reveal(lastPresented, generation)
      return
    }
    const epoch = generation
    if (raf !== null) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = null
      reveal(video.currentTime, epoch)
    })
  }
  video.addEventListener('seeked', settled)
  video.addEventListener('loadeddata', settled)

  return {
    prepare(time: number) {
      if (disposed) return
      capture()
      lastPresented = null
      target = time
      generation++
      cancel()
      visible = false
      video.style.opacity = '0'
      removeOverlay()
      const held = cache.get(trackId)
      if (held) {
        overlay = document.createElement('canvas')
        overlay.width = held.width
        overlay.height = held.height
        overlay.getContext('2d')?.drawImage(held, 0, 0)
        Object.assign(overlay.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          objectFit: video.style.objectFit || 'contain',
          pointerEvents: 'none',
        })
        overlay.setAttribute('aria-hidden', 'true')
        container.appendChild(overlay)
      }
      awaitFrame()
      settled()
    },
    dispose() {
      capture()
      disposed = true
      generation++
      cancel()
      removeOverlay()
      video.style.opacity = originalOpacity
      video.removeEventListener('seeked', settled)
      video.removeEventListener('loadeddata', settled)
    },
  }
}
