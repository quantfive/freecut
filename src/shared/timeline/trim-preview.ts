import type { TimelineItem } from '@/types/timeline'

export type TrimPreviewHandle = 'start' | 'end'
export type TrimPreviewMode = 'trim' | 'ripple' | 'rolling'

export interface ProjectTrimItemOptions {
  /** Timeline frames per second. */
  timelineFps?: number
  /** Keep the item's timeline start fixed while its source window changes. */
  positioning?: 'standard' | 'anchor-start'
}

export interface TrimProjectionSourceBoundary {
  itemId: string
  before: {
    start: number
    end?: number
  }
  after: {
    start: number
    end?: number
  }
}

export interface TrimProjection {
  itemId: string
  handle: TrimPreviewHandle
  mode: TrimPreviewMode
  requestedDeltaFrames: number
  timeline: {
    deltaFrames: number
    editPointBeforeFrame: number
    editPointAfterFrame: number
    rippleShiftFrames: number
    updates: TimelineItem[]
  }
  source: {
    boundaries: TrimProjectionSourceBoundary[]
  }
}

export interface ProjectTrimOperationParams {
  items: readonly TimelineItem[]
  itemId: string
  handle: TrimPreviewHandle
  mode: TrimPreviewMode
  deltaFrames: number
  neighborId?: string | null
  trimmedItemIds?: readonly string[]
  downstreamItemIds?: Iterable<string>
  timelineFps?: number
}

const DEFAULT_TIMELINE_FPS = 30

function normalizePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function isSourceItem(item: TimelineItem): item is TimelineItem & {
  type: 'video' | 'audio' | 'composition'
  sourceStart?: number
  sourceEnd?: number
  sourceDuration?: number
  sourceFps?: number
  speed?: number
} {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition'
}

function getSourceStart(item: TimelineItem & { type: 'video' | 'audio' | 'composition' }): number {
  if (item.sourceStart !== undefined && Number.isFinite(item.sourceStart)) {
    return item.sourceStart
  }

  const legacyTrimStart = 'trimStart' in item ? item.trimStart : undefined
  if (typeof legacyTrimStart === 'number' && Number.isFinite(legacyTrimStart)) {
    return legacyTrimStart
  }

  const legacyOffset = 'offset' in item ? item.offset : undefined
  return typeof legacyOffset === 'number' && Number.isFinite(legacyOffset) ? legacyOffset : 0
}

function timelineToSourceFrames(
  timelineFrames: number,
  speed: number,
  timelineFps: number,
  sourceFps: number,
): number {
  return Math.round((timelineFrames / timelineFps) * sourceFps * speed)
}

function sourceToTimelineFrames(
  sourceFrames: number,
  speed: number,
  timelineFps: number,
  sourceFps: number,
): number {
  return Math.floor(((Math.max(0, sourceFrames) / sourceFps) * timelineFps) / speed)
}

function getCurrentSourceEnd(
  item: TimelineItem & {
    type: 'video' | 'audio' | 'composition'
    sourceStart?: number
    sourceEnd?: number
    sourceDuration?: number
    sourceFps?: number
    speed?: number
  },
  sourceStart: number,
  timelineFps: number,
  sourceFps: number,
  speed: number,
): number {
  if (item.sourceEnd !== undefined && Number.isFinite(item.sourceEnd)) {
    return item.sourceEnd
  }
  if (item.isReversed === true && item.sourceDuration !== undefined) {
    return item.sourceDuration
  }
  return sourceStart + timelineToSourceFrames(item.durationInFrames, speed, timelineFps, sourceFps)
}

function clampSourceStart(value: number, currentEnd: number, sourceDuration?: number): number {
  const upperBound = Math.max(0, currentEnd - 1)
  const bounded = Math.max(0, Math.min(upperBound, value))
  if (sourceDuration === undefined || !Number.isFinite(sourceDuration)) return bounded
  return Math.min(Math.max(0, sourceDuration - 1), bounded)
}

function clampSourceEnd(value: number, sourceStart: number, sourceDuration?: number): number {
  const bounded = Math.max(sourceStart + 1, value)
  if (sourceDuration === undefined || !Number.isFinite(sourceDuration)) return bounded
  return Math.min(sourceDuration, bounded)
}

function clampTrimDeltaToTimelineBounds(
  item: TimelineItem,
  handle: TrimPreviewHandle,
  deltaFrames: number,
): number {
  const minimumDurationDelta =
    handle === 'start' ? item.durationInFrames - 1 : -item.durationInFrames + 1
  return handle === 'start'
    ? Math.min(deltaFrames, minimumDurationDelta)
    : Math.max(deltaFrames, minimumDurationDelta)
}

function clampTrimDeltaToSourceBounds(
  item: TimelineItem & {
    type: 'video' | 'audio' | 'composition'
    sourceDuration?: number
    sourceFps?: number
    speed?: number
  },
  handle: TrimPreviewHandle,
  deltaFrames: number,
  timelineFps: number,
  sourceFps: number,
  speed: number,
): number {
  if (item.sourceDuration === undefined || !Number.isFinite(item.sourceDuration)) {
    return deltaFrames
  }

  const sourceStart = getSourceStart(item)
  const currentSourceEnd = getCurrentSourceEnd(item, sourceStart, timelineFps, sourceFps, speed)
  if (handle === 'start' && deltaFrames < 0) {
    const available =
      item.isReversed === true ? item.sourceDuration - currentSourceEnd : sourceStart
    const maxExtension = sourceToTimelineFrames(available, speed, timelineFps, sourceFps)
    return Math.max(deltaFrames, -maxExtension)
  }
  if (handle === 'end' && deltaFrames > 0) {
    const available = item.isReversed === true ? sourceStart : item.sourceDuration - sourceStart
    const maxExtension = sourceToTimelineFrames(available, speed, timelineFps, sourceFps)
    return Math.min(deltaFrames, maxExtension)
  }
  return deltaFrames
}

function projectSourceWindow(
  item: TimelineItem & {
    type: 'video' | 'audio' | 'composition'
    sourceStart?: number
    sourceEnd?: number
    sourceDuration?: number
    sourceFps?: number
    speed?: number
  },
  handle: TrimPreviewHandle,
  sourceDelta: number,
  nextDuration: number,
  timelineFps: number,
  sourceFps: number,
  speed: number,
): Pick<TimelineItem, 'sourceStart' | 'sourceEnd'> {
  const sourceStart = getSourceStart(item)
  const currentSourceEnd = getCurrentSourceEnd(item, sourceStart, timelineFps, sourceFps, speed)
  let nextSourceStart = sourceStart
  let nextSourceEnd = item.sourceEnd

  if (item.isReversed === true) {
    if (handle === 'start') {
      nextSourceEnd = clampSourceEnd(
        currentSourceEnd - sourceDelta,
        sourceStart,
        item.sourceDuration,
      )
    } else {
      nextSourceStart = clampSourceStart(
        sourceStart - sourceDelta,
        currentSourceEnd,
        item.sourceDuration,
      )
    }
  } else if (handle === 'start') {
    nextSourceStart = clampSourceStart(
      sourceStart + sourceDelta,
      currentSourceEnd,
      item.sourceDuration,
    )
  } else {
    const requestedEnd =
      item.sourceEnd !== undefined
        ? currentSourceEnd + sourceDelta
        : sourceStart + timelineToSourceFrames(nextDuration, speed, timelineFps, sourceFps)
    nextSourceEnd = clampSourceEnd(requestedEnd, sourceStart, item.sourceDuration)
  }

  return {
    ...(nextSourceStart !== sourceStart || item.sourceStart !== undefined
      ? { sourceStart: nextSourceStart }
      : {}),
    ...(nextSourceEnd !== undefined ? { sourceEnd: nextSourceEnd } : {}),
  }
}

/**
 * Project one trim without mutating the authoritative timeline item.
 *
 * `from` and `durationInFrames` are timeline-domain values. `sourceStart` and
 * `sourceEnd` are source-domain values, converted with the item's source FPS
 * and speed. Reversed media moves the opposite source boundary for each edge.
 */
export function projectTrimItem(
  item: TimelineItem,
  handle: TrimPreviewHandle,
  deltaFrames: number,
  options: ProjectTrimItemOptions = {},
): TimelineItem {
  const timelineFps = normalizePositive(options.timelineFps, DEFAULT_TIMELINE_FPS)
  const requestedDelta = Number.isFinite(deltaFrames) ? deltaFrames : 0
  const timelineBoundedDelta = clampTrimDeltaToTimelineBounds(item, handle, requestedDelta)
  const safeDelta = isSourceItem(item)
    ? clampTrimDeltaToSourceBounds(
        item,
        handle,
        timelineBoundedDelta,
        timelineFps,
        normalizePositive(item.sourceFps, timelineFps),
        normalizePositive(item.speed, 1),
      )
    : timelineBoundedDelta
  const nextDuration = Math.max(
    1,
    handle === 'start' ? item.durationInFrames - safeDelta : item.durationInFrames + safeDelta,
  )
  const nextFrom =
    handle === 'start' && options.positioning !== 'anchor-start' ? item.from + safeDelta : item.from

  if (!isSourceItem(item)) {
    return {
      ...item,
      from: nextFrom,
      durationInFrames: nextDuration,
    }
  }

  const sourceFps = normalizePositive(item.sourceFps, timelineFps)
  const speed = normalizePositive(item.speed, 1)
  const sourceDelta = timelineToSourceFrames(safeDelta, speed, timelineFps, sourceFps)
  const sourceWindow = projectSourceWindow(
    item,
    handle,
    sourceDelta,
    nextDuration,
    timelineFps,
    sourceFps,
    speed,
  )

  return {
    ...item,
    from: nextFrom,
    durationInFrames: nextDuration,
    ...sourceWindow,
  }
}

function addProjectedItem(
  updatesById: Map<string, TimelineItem>,
  sourceBoundaries: TrimProjectionSourceBoundary[],
  item: TimelineItem,
  handle: TrimPreviewHandle,
  deltaFrames: number,
  options: ProjectTrimItemOptions,
): TimelineItem {
  const projected = projectTrimItem(item, handle, deltaFrames, options)
  updatesById.set(item.id, projected)

  if (isSourceItem(item) && isSourceItem(projected)) {
    const beforeStart = getSourceStart(item)
    const afterStart = getSourceStart(projected)
    const timelineFps = normalizePositive(options.timelineFps, DEFAULT_TIMELINE_FPS)
    const sourceFps = normalizePositive(item.sourceFps, timelineFps)
    const speed = normalizePositive(item.speed, 1)
    sourceBoundaries.push({
      itemId: item.id,
      before: {
        start: beforeStart,
        end: getCurrentSourceEnd(item, beforeStart, timelineFps, sourceFps, speed),
      },
      after: {
        start: afterStart,
        end: getCurrentSourceEnd(projected, afterStart, timelineFps, sourceFps, speed),
      },
    })
  }

  return projected
}

interface TrimProjectionAccumulator {
  updatesById: Map<string, TimelineItem>
  sourceBoundaries: TrimProjectionSourceBoundary[]
  options: ProjectTrimItemOptions
}

function projectRollingOperation(
  params: ProjectTrimOperationParams,
  anchor: TimelineItem,
  accumulator: TrimProjectionAccumulator,
): void {
  const neighbor = params.neighborId
    ? params.items.find((item) => item.id === params.neighborId)
    : undefined
  if (!neighbor) return

  const neighborHandle: TrimPreviewHandle = params.handle === 'end' ? 'start' : 'end'
  addProjectedItem(
    accumulator.updatesById,
    accumulator.sourceBoundaries,
    anchor,
    params.handle,
    params.deltaFrames,
    accumulator.options,
  )
  addProjectedItem(
    accumulator.updatesById,
    accumulator.sourceBoundaries,
    neighbor,
    neighborHandle,
    params.deltaFrames,
    accumulator.options,
  )
}

function projectRippleOperation(
  params: ProjectTrimOperationParams,
  anchor: TimelineItem,
  accumulator: TrimProjectionAccumulator,
): number {
  addProjectedItem(
    accumulator.updatesById,
    accumulator.sourceBoundaries,
    anchor,
    params.handle,
    params.deltaFrames,
    params.handle === 'start'
      ? { ...accumulator.options, positioning: 'anchor-start' }
      : accumulator.options,
  )

  const rippleShiftFrames = params.handle === 'end' ? params.deltaFrames : -params.deltaFrames
  if (rippleShiftFrames === 0) return rippleShiftFrames

  const downstreamIds = new Set(params.downstreamItemIds ?? [])
  for (const item of params.items) {
    if (!downstreamIds.has(item.id) || item.id === anchor.id) continue
    accumulator.updatesById.set(item.id, {
      ...item,
      from: item.from + rippleShiftFrames,
    })
  }
  return rippleShiftFrames
}

function projectStandardOperation(
  params: ProjectTrimOperationParams,
  anchor: TimelineItem,
  accumulator: TrimProjectionAccumulator,
): void {
  const ids = new Set(params.trimmedItemIds ?? [anchor.id])
  ids.add(anchor.id)
  for (const item of params.items) {
    if (!ids.has(item.id)) continue
    addProjectedItem(
      accumulator.updatesById,
      accumulator.sourceBoundaries,
      item,
      params.handle,
      params.deltaFrames,
      accumulator.options,
    )
  }
}

function populateTrimProjection(
  params: ProjectTrimOperationParams,
  anchor: TimelineItem,
  accumulator: TrimProjectionAccumulator,
): number {
  if (params.mode === 'rolling') {
    projectRollingOperation(params, anchor, accumulator)
    return 0
  }
  if (params.mode === 'ripple') return projectRippleOperation(params, anchor, accumulator)
  projectStandardOperation(params, anchor, accumulator)
  return 0
}

/**
 * Build the complete non-destructive projection for standard, ripple, or
 * rolling trim. The returned updates are full timeline items so consumers can
 * merge them into either a DOM composition or a fast-scrub renderer snapshot.
 */
export function projectTrimOperation(params: ProjectTrimOperationParams): TrimProjection | null {
  const anchor = params.items.find((item) => item.id === params.itemId)
  if (!anchor) return null

  const timelineFps = normalizePositive(params.timelineFps, DEFAULT_TIMELINE_FPS)
  const accumulator: TrimProjectionAccumulator = {
    updatesById: new Map<string, TimelineItem>(),
    sourceBoundaries: [],
    options: { timelineFps },
  }
  const editPointBeforeFrame =
    params.handle === 'start' ? anchor.from : anchor.from + anchor.durationInFrames
  const rippleShiftFrames = populateTrimProjection(params, anchor, accumulator)
  const projectedAnchor = accumulator.updatesById.get(anchor.id) ?? anchor
  const editPointAfterFrame =
    params.handle === 'start'
      ? projectedAnchor.from
      : projectedAnchor.from + projectedAnchor.durationInFrames

  return {
    itemId: anchor.id,
    handle: params.handle,
    mode: params.mode,
    requestedDeltaFrames: params.deltaFrames,
    timeline: {
      deltaFrames: params.deltaFrames,
      editPointBeforeFrame,
      editPointAfterFrame,
      rippleShiftFrames,
      updates: params.items
        .map((item) => accumulator.updatesById.get(item.id))
        .filter((item): item is TimelineItem => item !== undefined),
    },
    source: {
      boundaries: accumulator.sourceBoundaries,
    },
  }
}
