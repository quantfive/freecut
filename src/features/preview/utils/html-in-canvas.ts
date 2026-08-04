interface HtmlInCanvasProbeElement extends HTMLCanvasElement {
  layoutSubtree?: boolean
  requestPaint?: () => void
}

interface HtmlInCanvasProbeContext extends CanvasRenderingContext2D {
  drawElementImage?: (element: Element, dx: number, dy: number) => DOMMatrix
}

interface HtmlInCanvasPlaybackEligibility {
  fastRendererEnabled: boolean
  domTextOverlayEnabled: boolean
  comparisonEnabled: boolean
  htmlInCanvasSupported: boolean
}

export function shouldEnableHtmlInCanvasPlayback({
  fastRendererEnabled,
  comparisonEnabled,
}: HtmlInCanvasPlaybackEligibility): boolean {
  // Canvas-owned media/compositing does not require the experimental DOM paint
  // API. Text uses that bridge when available and the existing DOM overlay as
  // its compatibility fallback, so unsupported browsers can still use the
  // low-copy canvas playback lane for the rest of the scene.
  return fastRendererEnabled && !comparisonEnabled
}

/**
 * HTML-in-canvas is an experimental Chromium surface. Probe the complete API
 * contract before routing playback through it so other browsers stay on the
 * established DOM composition path.
 */
export function supportsHtmlInCanvas(): boolean {
  if (typeof document === 'undefined') return false

  const canvas = document.createElement('canvas') as HtmlInCanvasProbeElement
  canvas.setAttribute('layoutsubtree', '')
  const context = canvas.getContext('2d') as HtmlInCanvasProbeContext | null

  return (
    'layoutSubtree' in canvas &&
    typeof canvas.requestPaint === 'function' &&
    typeof context?.drawElementImage === 'function'
  )
}
