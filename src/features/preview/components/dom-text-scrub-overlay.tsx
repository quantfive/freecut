import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import type { CompositionInputProps } from '@/types/export'
import { HeadlessPlayer, type PlayerRef } from '@/features/preview/deps/player-core'
import { MainComposition } from '@/features/preview/deps/composition-runtime'
import { useItemsStore } from '@/features/preview/deps/timeline-store'
import { supportsHtmlInCanvas } from '../utils/html-in-canvas'
import { copyPreviewDisplayCanvasContent } from '../utils/preview-display-canvas'

interface DomTextScrubOverlayProps {
  playerRef: RefObject<PlayerRef | null>
  visible: boolean
  durationInFrames: number
  fps: number
  renderSize: { width: number; height: number }
  layoutSize: { width: number; height: number }
  inputProps: CompositionInputProps
  backgroundCanvasRef?: RefObject<HTMLCanvasElement | null>
  htmlInCanvasEnabled?: boolean
}

interface HtmlInCanvasElement extends HTMLCanvasElement {
  layoutSubtree?: boolean
  requestPaint?: () => void
  onpaint?: ((event: Event) => void) | null
}

interface HtmlInCanvasContext extends CanvasRenderingContext2D {
  drawElementImage?: (element: Element, dx: number, dy: number) => DOMMatrix
}

interface HtmlInCanvasPreviewDiagnostics {
  supported: boolean
  active: boolean
  failure?: string
  reset: () => void
  snapshot: () => {
    supported: boolean
    active: boolean
    failure?: string
    paints: number
    distinctFrames: number
    effectivePaintFps: number
    p95PaintIntervalMs: number
    p95CompositeMs: number
    maxCompositeMs: number
  }
}

interface MutableDiagnostics extends HtmlInCanvasPreviewDiagnostics {
  recordPaint: (frame: number, paintAt: number, compositeMs: number) => void
}

declare global {
  interface Window {
    __FREECUT_HTML_IN_CANVAS_PREVIEW__?: HtmlInCanvasPreviewDiagnostics
  }
}

const MAX_DIAGNOSTIC_SAMPLES = 600

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))] ?? 0
}

function createDiagnostics(supported: boolean): MutableDiagnostics {
  let active = false
  let failure: string | undefined
  let paints = 0
  let firstPaintAt: number | null = null
  let lastPaintAt: number | null = null
  let previousPaintAt: number | null = null
  const distinctFrames = new Set<number>()
  const paintIntervals: number[] = []
  const compositeTimes: number[] = []

  const reset = () => {
    paints = 0
    firstPaintAt = null
    lastPaintAt = null
    previousPaintAt = null
    distinctFrames.clear()
    paintIntervals.length = 0
    compositeTimes.length = 0
  }

  return {
    supported,
    get active() {
      return active
    },
    set active(value: boolean) {
      active = value
    },
    get failure() {
      return failure
    },
    set failure(value: string | undefined) {
      failure = value
    },
    reset,
    snapshot: () => {
      const elapsedMs =
        firstPaintAt === null || lastPaintAt === null ? 0 : Math.max(0, lastPaintAt - firstPaintAt)
      return {
        supported,
        active,
        failure,
        paints,
        distinctFrames: distinctFrames.size,
        effectivePaintFps:
          paints <= 1 || elapsedMs === 0 ? 0 : Number((((paints - 1) * 1000) / elapsedMs).toFixed(1)),
        p95PaintIntervalMs: Number(percentile(paintIntervals, 0.95).toFixed(3)),
        p95CompositeMs: Number(percentile(compositeTimes, 0.95).toFixed(3)),
        maxCompositeMs: Number(Math.max(0, ...compositeTimes).toFixed(3)),
      }
    },
    recordPaint(frame: number, paintAt: number, compositeMs: number) {
      paints += 1
      firstPaintAt ??= paintAt
      lastPaintAt = paintAt
      distinctFrames.add(frame)
      if (previousPaintAt !== null) paintIntervals.push(paintAt - previousPaintAt)
      previousPaintAt = paintAt
      compositeTimes.push(compositeMs)
      if (paintIntervals.length > MAX_DIAGNOSTIC_SAMPLES) paintIntervals.shift()
      if (compositeTimes.length > MAX_DIAGNOSTIC_SAMPLES) compositeTimes.shift()
    },
  }
}

const ignoreFrameChange = () => undefined
const ignorePlayStateChange = () => undefined

/**
 * A text-only Player that remains mounted beside the primary composition.
 * Scrub updates are coalesced to one seek per animation frame, keeping native
 * DOM/CSS text metrics without making media elements participate in the seek.
 */
export const DomTextScrubOverlay = memo(function DomTextScrubOverlay({
  playerRef,
  visible,
  durationInFrames,
  fps,
  renderSize,
  layoutSize,
  inputProps,
  backgroundCanvasRef,
  htmlInCanvasEnabled = false,
}: DomTextScrubOverlayProps) {
  const pendingFrameRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const hybridCanvasRef = useRef<HtmlInCanvasElement | null>(null)
  const hybridTextRootRef = useRef<HTMLDivElement | null>(null)
  const [hybridFailure, setHybridFailure] = useState<string | null>(null)
  const hybridSupported = useMemo(
    () => htmlInCanvasEnabled && !hybridFailure && supportsHtmlInCanvas(),
    [htmlInCanvasEnabled, hybridFailure],
  )

  const flushFrame = useCallback(() => {
    rafRef.current = null
    const frame = pendingFrameRef.current
    pendingFrameRef.current = null
    if (frame === null || frame === lastFrameRef.current || !playerRef.current) return
    playerRef.current.seekTo(frame)
    lastFrameRef.current = frame
    hybridCanvasRef.current?.requestPaint?.()
  }, [playerRef])

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return

    const diagnostics = createDiagnostics(hybridSupported)
    diagnostics.active = hybridSupported
    window.__FREECUT_HTML_IN_CANVAS_PREVIEW__ = diagnostics
    if (!hybridSupported) return

    const canvas = hybridCanvasRef.current
    const textRoot = hybridTextRootRef.current
    const sourceCanvas = backgroundCanvasRef?.current
    const context = canvas?.getContext('2d') as HtmlInCanvasContext | null | undefined
    if (!canvas || !textRoot || !sourceCanvas || !context?.drawElementImage) {
      diagnostics.active = false
      diagnostics.failure = 'The preview compositor could not acquire its canvas surfaces.'
      setHybridFailure(diagnostics.failure)
      return
    }

    canvas.layoutSubtree = true
    if (canvas.width !== renderSize.width) canvas.width = renderSize.width
    if (canvas.height !== renderSize.height) canvas.height = renderSize.height

    const publishDiagnosticSnapshot = () => {
      if (!import.meta.env.DEV) return
      const snapshot = diagnostics.snapshot()
      canvas.dataset.htmlInCanvasPaints = String(snapshot.paints)
      canvas.dataset.htmlInCanvasFps = String(snapshot.effectivePaintFps)
      canvas.dataset.htmlInCanvasP95IntervalMs = String(snapshot.p95PaintIntervalMs)
      canvas.dataset.htmlInCanvasP95CompositeMs = String(snapshot.p95CompositeMs)
      canvas.dataset.htmlInCanvasMaxCompositeMs = String(snapshot.maxCompositeMs)
    }
    const resetDiagnostics = () => {
      diagnostics.reset()
      publishDiagnosticSnapshot()
    }
    canvas.addEventListener('freecut-html-in-canvas-reset', resetDiagnostics)
    const unsubscribePlaybackDiagnostics = usePlaybackStore.subscribe((state, previousState) => {
      if (state.isPlaying && !previousState.isPlaying) {
        resetDiagnostics()
      } else if (!state.isPlaying && previousState.isPlaying) {
        publishDiagnosticSnapshot()
      }
    })
    publishDiagnosticSnapshot()
    let cachedPaintMisses = 0
    let retryPaintRaf: number | null = null

    canvas.onpaint = () => {
      const paintAt = performance.now()
      try {
        context.reset()
        copyPreviewDisplayCanvasContent(sourceCanvas, context)
        const transform = context.drawElementImage?.(textRoot, 0, 0)
        if (!transform) throw new Error('drawElementImage did not return a transform')
        textRoot.style.transform = transform.toString()
        diagnostics.recordPaint(lastFrameRef.current ?? 0, paintAt, performance.now() - paintAt)
        cachedPaintMisses = 0
        const paints = diagnostics.snapshot().paints
        if (paints === 1 || paints % 15 === 0) publishDiagnosticSnapshot()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('No cached paint record') && cachedPaintMisses < 3) {
          cachedPaintMisses += 1
          if (import.meta.env.DEV) {
            canvas.dataset.htmlInCanvasPaintRecordRetries = String(cachedPaintMisses)
          }
          retryPaintRaf = requestAnimationFrame(() => {
            retryPaintRaf = null
            canvas.requestPaint?.()
          })
          return
        }
        diagnostics.active = false
        diagnostics.failure = message
        canvas.onpaint = null
        setHybridFailure(diagnostics.failure)
      }
    }
    canvas.requestPaint?.()

    return () => {
      canvas.onpaint = null
      canvas.removeEventListener('freecut-html-in-canvas-reset', resetDiagnostics)
      unsubscribePlaybackDiagnostics()
      if (retryPaintRaf !== null) cancelAnimationFrame(retryPaintRaf)
      diagnostics.active = false
    }
  }, [backgroundCanvasRef, hybridSupported, renderSize.height, renderSize.width, visible])

  useLayoutEffect(() => {
    if (!visible) return

    const queueFrame = (frame: number) => {
      pendingFrameRef.current = Math.max(0, Math.round(frame))
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushFrame)
      }
    }
    const getVisibleFrame = () => {
      const playbackState = usePlaybackStore.getState()
      return getResolvedPlaybackFrame({
        currentFrame: playbackState.currentFrame,
        currentFrameEpoch: playbackState.currentFrameEpoch,
        previewFrame: playbackState.previewFrame,
        previewFrameEpoch: playbackState.previewFrameEpoch,
        isPlaying: playbackState.isPlaying,
        displayedFrame: usePreviewBridgeStore.getState().displayedFrame,
      })
    }
    let resolvedFrame = getVisibleFrame()
    queueFrame(resolvedFrame)

    const syncVisibleFrame = () => {
      const frame = getVisibleFrame()
      if (frame === resolvedFrame) return
      resolvedFrame = frame
      queueFrame(frame)
    }
    const unsubscribePlayback = usePlaybackStore.subscribe(syncVisibleFrame)
    const unsubscribePreviewBridge = usePreviewBridgeStore.subscribe(syncVisibleFrame)

    return () => {
      unsubscribePlayback()
      unsubscribePreviewBridge()
      pendingFrameRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [flushFrame, visible])

  const player = (
    <HeadlessPlayer
      ref={playerRef}
      durationInFrames={durationInFrames}
      fps={fps}
      width={renderSize.width}
      height={renderSize.height}
      autoPlay={false}
      loop={false}
      layoutSize={layoutSize}
      style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
      onFrameChange={ignoreFrameChange}
      onPlayStateChange={ignorePlayStateChange}
    >
      <MainComposition
        {...inputProps}
        backgroundColor="transparent"
        useProxyMedia
        transparentBackground
        liveItemTransformSource={useItemsStore}
      />
    </HeadlessPlayer>
  )

  if (hybridSupported) {
    return (
      <canvas
        {...({ layoutsubtree: '' } as Record<string, string>)}
        ref={hybridCanvasRef}
        aria-hidden="true"
        data-dom-text-scrub-overlay
        data-html-in-canvas-preview="active"
        className="absolute inset-0 pointer-events-none"
        style={{
          width: '100%',
          height: '100%',
          zIndex: 6,
          visibility: 'visible',
          opacity: visible ? 1 : 0,
          contain: 'layout paint style',
        }}
      >
        <div
          ref={hybridTextRootRef}
          className="absolute inset-0"
          style={{ contain: 'layout paint style' }}
        >
          {player}
        </div>
      </canvas>
    )
  }

  return (
    <div
      aria-hidden="true"
      data-dom-text-scrub-overlay
      data-html-in-canvas-preview={htmlInCanvasEnabled ? 'fallback' : 'disabled'}
      data-html-in-canvas-failure={hybridFailure ?? undefined}
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 6,
        visibility: visible ? 'visible' : 'hidden',
        contain: 'layout paint style',
      }}
    >
      {player}
    </div>
  )
})
