const TIMELINE_POINTER_CONTROL_SELECTOR = [
  '[data-timeline-interaction-control]',
  '[data-marquee-ignore]',
  '[data-trim-handle]',
  '[data-clip-fade-controls]',
  '[data-track-push]',
  '[data-playhead-handle]',
  '[role="menu"]',
  '[role="scrollbar"]',
  '.timeline-ruler',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  '[contenteditable="true"]',
].join(',')

export function isTimelinePointerControl(target: Element | null): boolean {
  return Boolean(target?.closest(TIMELINE_POINTER_CONTROL_SELECTOR))
}

export function resolveTimelinePointerFrame({
  clientX,
  container,
  pixelsToFrame,
  maxTimelineFrame,
  fallbackFrame,
}: {
  clientX: number
  container: Pick<HTMLDivElement, 'getBoundingClientRect' | 'scrollLeft'> | null
  pixelsToFrame: (pixels: number) => number
  maxTimelineFrame: number
  fallbackFrame: number
}): number {
  if (!container) {
    return clampTimelinePointerFrame(fallbackFrame, maxTimelineFrame)
  }

  const localX = clientX - container.getBoundingClientRect().left + container.scrollLeft
  return clampTimelinePointerFrame(pixelsToFrame(localX), maxTimelineFrame)
}

function clampTimelinePointerFrame(frame: number, maxTimelineFrame: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.max(0, Math.min(Math.round(frame), Math.max(0, maxTimelineFrame)))
}
