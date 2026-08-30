/**
 * The timeline's immediate pointer intent.
 *
 * The playback preview is deliberately not used for keyboard edits: it is
 * throttled, can be held while a gesture is finishing, and may represent the
 * last pointer location rather than the current one. This tiny non-reactive
 * state lets a command read the frame that was most recently hit by the
 * timeline without causing a store update on every mousemove.
 */
export interface TimelineHoverState {
  itemId: string | null
  frame: number | null
}

let timelineHoverState: TimelineHoverState = {
  itemId: null,
  frame: null,
}

export function setTimelineHover(itemId: string | null | undefined, frame: number | null): void {
  if (!itemId || frame === null || !Number.isFinite(frame)) {
    clearTimelineHover()
    return
  }

  timelineHoverState = { itemId, frame }
}

export function getTimelineHover(): TimelineHoverState {
  return timelineHoverState
}

export function clearTimelineHover(): void {
  timelineHoverState = { itemId: null, frame: null }
}
