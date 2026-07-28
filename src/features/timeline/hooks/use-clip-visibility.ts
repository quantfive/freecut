import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'

/**
 * Pixels of margin beyond the viewport for considering a clip "visible".
 * Increased from 200 to 600 to absorb the 50ms viewport store throttle —
 * at fast scroll speeds (~200px/frame × 3 frames), tiles stay pre-rendered
 * 600px ahead, preventing blank flashes at the leading edge.
 */
export const CLIP_VISIBILITY_PREFETCH_MARGIN_PX = 600
const RATIO_EPSILON = 0.002

export interface ClipVisibilityState {
  isVisible: boolean
  visibleStartRatio: number
  visibleEndRatio: number
}

interface ClipVisibilityEntry {
  clipLeftPx: number
  clipWidthPx: number
  snapshot: ClipVisibilityState
  listeners: Set<() => void>
}

const registeredEntries = new Set<ClipVisibilityEntry>()
let unsubscribeViewport: (() => void) | null = null
let unsubscribeZoom: (() => void) | null = null

function areVisibilityStatesEqual(
  previous: ClipVisibilityState,
  next: ClipVisibilityState,
): boolean {
  return (
    previous.isVisible === next.isVisible &&
    Math.abs(previous.visibleStartRatio - next.visibleStartRatio) < RATIO_EPSILON &&
    Math.abs(previous.visibleEndRatio - next.visibleEndRatio) < RATIO_EPSILON
  )
}

function publishEntrySnapshot(entry: ClipVisibilityEntry, next: ClipVisibilityState): void {
  if (areVisibilityStatesEqual(entry.snapshot, next)) return
  entry.snapshot = next
  for (const listener of entry.listeners) listener()
}

function recomputeRegisteredEntries(): void {
  if (useZoomStore.getState().isZoomInteracting) return

  const viewport = useTimelineViewportStore.getState()
  for (const entry of registeredEntries) {
    publishEntrySnapshot(
      entry,
      computeVisibility(viewport, entry.clipLeftPx, entry.clipWidthPx),
    )
  }
}

function connectVisibilityRegistry(): void {
  if (unsubscribeViewport || unsubscribeZoom) return

  unsubscribeViewport = useTimelineViewportStore.subscribe(recomputeRegisteredEntries)
  unsubscribeZoom = useZoomStore.subscribe((current, previous) => {
    if (previous.isZoomInteracting && !current.isZoomInteracting) {
      recomputeRegisteredEntries()
    }
  })
}

function disconnectVisibilityRegistryIfIdle(): void {
  if (registeredEntries.size > 0) return
  unsubscribeViewport?.()
  unsubscribeViewport = null
  unsubscribeZoom?.()
  unsubscribeZoom = null
}

function createVisibilityEntry(clipLeftPx: number, clipWidthPx: number): ClipVisibilityEntry {
  return {
    clipLeftPx,
    clipWidthPx,
    snapshot: computeVisibility(
      useTimelineViewportStore.getState(),
      clipLeftPx,
      clipWidthPx,
    ),
    listeners: new Set(),
  }
}

/**
 * Hook to detect when a timeline clip is visible in the shared timeline viewport.
 * Uses one shared viewport/zoom subscription for every mounted clip instead of
 * registering two store subscriptions per clip. The registry still publishes
 * only to clips whose derived visibility window changed.
 *
 * During zoom interaction, clip positions and the viewport temporarily use
 * different coordinate spaces. Keep the last valid bounded window until zoom
 * settles instead of expanding every clip to its full duration.
 */
export function useClipVisibility(clipLeftPx: number, clipWidthPx: number): ClipVisibilityState {
  const [entry] = useState<ClipVisibilityEntry>(() =>
    createVisibilityEntry(clipLeftPx, clipWidthPx),
  )

  useLayoutEffect(() => {
    if (entry.clipLeftPx === clipLeftPx && entry.clipWidthPx === clipWidthPx) {
      return
    }
    entry.clipLeftPx = clipLeftPx
    entry.clipWidthPx = clipWidthPx
    if (!useZoomStore.getState().isZoomInteracting) {
      publishEntrySnapshot(
        entry,
        computeVisibility(useTimelineViewportStore.getState(), clipLeftPx, clipWidthPx),
      )
    }
  }, [clipLeftPx, clipWidthPx, entry])

  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener)
      registeredEntries.add(entry)
      connectVisibilityRegistry()

      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          registeredEntries.delete(entry)
          disconnectVisibilityRegistryIfIdle()
        }
      }
    },
    [entry],
  )
  const getSnapshot = useCallback(() => entry.snapshot, [entry])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface TimelineViewportSnapshot {
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

function computeVisibility(
  viewport: TimelineViewportSnapshot,
  clipLeftPx: number,
  clipWidthPx: number,
  prefetchMarginPx = CLIP_VISIBILITY_PREFETCH_MARGIN_PX,
): ClipVisibilityState {
  if (clipWidthPx <= 0 || viewport.viewportWidth <= 0) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const viewLeft = viewport.scrollLeft - prefetchMarginPx
  const viewRight = viewport.scrollLeft + viewport.viewportWidth + prefetchMarginPx
  const clipRightPx = clipLeftPx + clipWidthPx

  const overlapLeft = Math.max(clipLeftPx, viewLeft)
  const overlapRight = Math.min(clipRightPx, viewRight)
  const isVisible = overlapRight > overlapLeft

  if (!isVisible) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const startRatio = Math.max(0, Math.min(1, (overlapLeft - clipLeftPx) / clipWidthPx))
  const endRatio = Math.max(startRatio, Math.min(1, (overlapRight - clipLeftPx) / clipWidthPx))

  return {
    isVisible: true,
    visibleStartRatio: startRatio,
    visibleEndRatio: endRatio,
  }
}
