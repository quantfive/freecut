import type React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { DragState, UseTimelineDragReturn, SnapTarget } from '../types/drag'
import { useTimelineStore } from '../stores/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore, type SelectionState } from '@/shared/state/selection'
import {
  pixelsToFramePreciseNow,
  frameToPixelsNow,
} from '@/features/timeline/utils/zoom-conversions'
import { useSnapCalculator } from './use-snap-calculator'
import {
  findNearestAvailableSharedOffset,
  findNearestAvailableSpace,
} from '../utils/collision-utils'
import { getTrackKind } from '../utils/classic-tracks'
import {
  expandItemIdsWithAttachedCaptions,
  buildLinkedMovePreviewUpdates,
  expandSelectionWithLinkedItems,
  filterUnlockedItemIds,
  getLinkedItemIds,
} from '../utils/linked-items'
import { findCompatibleTrackForItemType } from '../utils/track-item-compatibility'
import {
  resolveCreateNewDragTrackTargets,
  resolveLinkedCohortDragTrackTargets,
  type LinkedDragDropZone,
} from '../utils/linked-drag-targeting'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { DRAG_THRESHOLD_PIXELS } from '../constants'
import { createLogger } from '@/shared/logging/logger'
import { createRafCoalescedCallback } from '../utils/raf-coalesced-callback'
import { resolveEffectiveTrackStates } from '../utils/group-utils'
import { suppressPostTimelineGestureClick } from '../components/timeline-item/post-drag-click-guard'

const logger = createLogger('TimelineDrag')

// Shared ref for drag offset (avoids re-renders from store updates)
export const dragOffsetRef = { current: { x: 0, y: 0 } }
export const dragPreviewOffsetByItemRef = {
  current: {} as Record<string, { x: number; y: number }>,
}

const LARGE_ALT_DRAG_CANVAS_THRESHOLD = 24

interface LargeAltDragCanvasEntry {
  id: string
  left: number
  top: number
  width: number
  height: number
}

interface LargeAltDragCanvasState {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  entries: LargeAltDragCanvasEntry[]
  itemIds: Set<string>
  dpr: number
}

let largeAltDragCanvasState: LargeAltDragCanvasState | null = null

export function isLargeAltDragCanvasItem(itemId: string): boolean {
  return largeAltDragCanvasState?.itemIds.has(itemId) ?? false
}

function clearLargeAltDragCanvas() {
  largeAltDragCanvasState?.canvas.remove()
  largeAltDragCanvasState = null
}

function startLargeAltDragCanvas(itemIds: string[]) {
  clearLargeAltDragCanvas()
  if (itemIds.length < LARGE_ALT_DRAG_CANVAS_THRESHOLD) return

  const timeline = document.querySelector('.timeline-container')
  if (!timeline) return

  const entries = itemIds
    .map((id): LargeAltDragCanvasEntry | null => {
      const element = timeline.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    })
    .filter((entry): entry is LargeAltDragCanvasEntry => entry !== null)
  if (entries.length < LARGE_ALT_DRAG_CANVAS_THRESHOLD) return

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(window.innerWidth * dpr)
  canvas.height = Math.ceil(window.innerHeight * dpr)
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '10000'
  canvas.style.contain = 'strict'
  canvas.setAttribute('data-large-alt-drag-canvas', 'true')

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  document.body.appendChild(canvas)

  largeAltDragCanvasState = {
    canvas,
    context,
    entries,
    itemIds: new Set(entries.map((entry) => entry.id)),
    dpr,
  }
  updateLargeAltDragCanvas({}, { x: 0, y: 0 })
}

function updateLargeAltDragCanvas(
  offsets: Record<string, { x: number; y: number }>,
  fallbackOffset: { x: number; y: number },
) {
  const state = largeAltDragCanvasState
  if (!state) return

  const { canvas, context, entries, dpr } = state
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  context.fillStyle = 'rgba(59, 130, 246, 0.2)'
  context.strokeStyle = 'rgba(96, 165, 250, 0.95)'
  context.lineWidth = 2
  context.setLineDash([6, 4])

  for (const entry of entries) {
    const offset = offsets[entry.id] ?? fallbackOffset
    const left = entry.left + offset.x
    const top = entry.top + offset.y
    context.fillRect(left, top, entry.width, entry.height)
    context.strokeRect(
      left + 1,
      top + 1,
      Math.max(0, entry.width - 2),
      Math.max(0, entry.height - 2),
    )
  }
}

/**
 * Clamp a proposed frame so the item doesn't visually overlap other items
 * on the target track during drag preview. Returns the clamped frame.
 * Excludes items in `excludeIds` (the dragged items themselves).
 */
function clampToTrackWalls(
  proposedFrom: number,
  durationInFrames: number,
  trackId: string,
  excludeIds: ReadonlySet<string>,
  allItems: ReadonlyArray<TimelineItem>,
  itemsByTrackId?: ReadonlyMap<string, ReadonlyArray<TimelineItem>>,
): number {
  const proposedEnd = proposedFrom + durationInFrames
  let leftWall = 0 // rightmost end of items to the left
  let rightWall = Infinity // leftmost start of items to the right

  const trackItems = itemsByTrackId?.get(trackId) ?? allItems
  for (const other of trackItems) {
    if (excludeIds.has(other.id) || other.trackId !== trackId) continue
    const otherEnd = other.from + other.durationInFrames

    if (otherEnd <= proposedFrom) {
      // Item fully to the left — track its right edge as potential wall
      if (otherEnd > leftWall) leftWall = otherEnd
    } else if (other.from >= proposedEnd) {
      // Item fully to the right — track its left edge as potential wall
      if (other.from < rightWall) rightWall = other.from
    } else {
      // Item overlaps the proposed position — find which side is closer
      // and use the tighter wall
      const distToLeft = proposedFrom - other.from
      const distToRight = otherEnd - proposedFrom
      if (distToLeft >= 0 && distToLeft <= distToRight) {
        // We're overlapping from the right side of other
        if (otherEnd > leftWall) leftWall = otherEnd
      } else {
        // We're overlapping from the left side of other
        if (other.from < rightWall) rightWall = other.from
      }
    }
  }

  const maxFrom = rightWall - durationInFrames
  return Math.max(leftWall, Math.min(maxFrom, proposedFrom))
}

const DRAG_CURSOR_CLASS_BY_MODE = {
  grabbing: 'timeline-item-drag-cursor-grabbing',
  copy: 'timeline-item-drag-cursor-copy',
  'not-allowed': 'timeline-item-drag-cursor-not-allowed',
} as const

type DragCursorMode = keyof typeof DRAG_CURSOR_CLASS_BY_MODE

const DRAG_CURSOR_CLASSES = Object.values(DRAG_CURSOR_CLASS_BY_MODE)
const TRACK_SECTION_DIVIDER_GAP = 0
const CROSS_TRACK_SNAP_THRESHOLD_PX = 18

function isLinkedDragCohort(items: TimelineItem[], draggedItemIds: readonly string[]): boolean {
  const draggedIdSet = new Set(draggedItemIds)

  for (const itemId of draggedItemIds) {
    if (
      getLinkedItemIds(items, itemId).some(
        (linkedId) => linkedId !== itemId && draggedIdSet.has(linkedId),
      )
    ) {
      return true
    }

    const draggedItem = items.find((item) => item.id === itemId)
    if (
      draggedItem?.type === 'text' &&
      draggedItem.captionSource &&
      draggedIdSet.has(draggedItem.captionSource.clipId)
    ) {
      return true
    }
  }

  return false
}

function getDragAnchorRelatedItemIds(items: TimelineItem[], anchorItemId: string): string[] {
  const relatedIds = new Set(getLinkedItemIds(items, anchorItemId))
  const anchorItem = items.find((item) => item.id === anchorItemId)

  if (anchorItem?.type === 'text' && anchorItem.captionSource) {
    relatedIds.add(anchorItem.captionSource.clipId)
    for (const linkedId of getLinkedItemIds(items, anchorItem.captionSource.clipId)) {
      relatedIds.add(linkedId)
    }
  }

  return Array.from(relatedIds)
}

interface DraggedTrackTargets {
  tracks: TimelineTrack[]
  trackAssignments: Map<string, string>
}

function resolveMultiDragTrackId(params: {
  draggedItem: { id: string; initialTrackId: string }
  trackTargets: DraggedTrackTargets | null
  isLinkedCohort: boolean
  dropZone: LinkedDragDropZone | null
  trackIndexById: ReadonlyMap<string, number>
  tracks: readonly TimelineTrack[]
  anchorTrackId: string
  targetAnchorTrackId: string
}): string | null {
  const assignedTrackId = params.trackTargets?.trackAssignments.get(params.draggedItem.id)
  if (assignedTrackId) return assignedTrackId
  if (params.isLinkedCohort && params.dropZone) return null

  const anchorTrackIndex = params.trackIndexById.get(params.anchorTrackId) ?? -1
  const itemTrackIndex = params.trackIndexById.get(params.draggedItem.initialTrackId) ?? -1
  const targetAnchorTrackIndex = params.trackIndexById.get(params.targetAnchorTrackId) ?? -1
  const trackOffset = itemTrackIndex - anchorTrackIndex
  const targetTrackIndex = Math.max(
    0,
    Math.min(params.tracks.length - 1, targetAnchorTrackIndex + trackOffset),
  )

  return params.tracks[targetTrackIndex]?.id ?? params.draggedItem.initialTrackId
}

function resolveDraggedTrackTargets(params: {
  items: TimelineItem[]
  draggedItems: Array<{ id: string; initialTrackId: string }>
  anchorItemId: string
  isLinkedCohort: boolean
  tracks: TimelineTrack[]
  dropTarget: { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean }
  preferredTrackHeight: number
}): { trackTargets: DraggedTrackTargets | null; isLinkedCohort: boolean } {
  const {
    items,
    draggedItems,
    anchorItemId,
    isLinkedCohort,
    tracks,
    dropTarget,
    preferredTrackHeight,
  } = params

  if (!dropTarget.zone) {
    return { trackTargets: null, isLinkedCohort }
  }

  if (isLinkedCohort) {
    const sourceItemById = new Map(items.map((item) => [item.id, item]))
    const linkedTrackTargets = resolveLinkedCohortDragTrackTargets({
      tracks,
      draggedItems: draggedItems
        .map((draggedItem) => {
          const sourceItem = sourceItemById.get(draggedItem.id)
          return sourceItem
            ? {
                id: sourceItem.id,
                initialTrackId: draggedItem.initialTrackId,
                type: sourceItem.type,
              }
            : null
        })
        .filter(
          (
            draggedItem,
          ): draggedItem is {
            id: string
            initialTrackId: string
            type: TimelineItem['type']
          } => draggedItem !== null,
        ),
      anchorItemId,
      anchorRelatedItemIds: getDragAnchorRelatedItemIds(items, anchorItemId),
      hoveredTrackId: dropTarget.trackId,
      zone: dropTarget.zone,
      createNew: dropTarget.createNew,
      preferredTrackHeight,
    })

    return {
      trackTargets: linkedTrackTargets,
      isLinkedCohort,
    }
  }

  if (!dropTarget.createNew) {
    return { trackTargets: null, isLinkedCohort }
  }

  const createNewTrackTargets = resolveCreateNewDragTrackTargets({
    tracks,
    draggedItems: draggedItems
      .map((draggedItem) => {
        const sourceItem = items.find((item) => item.id === draggedItem.id)
        return sourceItem
          ? {
              id: sourceItem.id,
              initialTrackId: draggedItem.initialTrackId,
              type: sourceItem.type,
            }
          : null
      })
      .filter(
        (
          draggedItem,
        ): draggedItem is { id: string; initialTrackId: string; type: TimelineItem['type'] } =>
          draggedItem !== null,
      ),
    zone: dropTarget.zone,
    preferredTrackHeight,
  })

  if (!createNewTrackTargets) {
    return { trackTargets: null, isLinkedCohort }
  }

  return {
    trackTargets: {
      tracks: createNewTrackTargets.tracks,
      trackAssignments: createNewTrackTargets.trackAssignments,
    },
    isLinkedCohort,
  }
}

function captureTrackVisualTops(): Map<string, number> {
  const laneRows = Array.from(document.querySelectorAll('.timeline-tracks [data-track-id]')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )
  const domTopByTrackId = new Map<string, number>()

  for (const row of laneRows) {
    const trackId = row.getAttribute('data-track-id')
    if (!trackId) continue
    domTopByTrackId.set(trackId, row.getBoundingClientRect().top)
  }

  return domTopByTrackId
}

function buildTrackVisualTopMap(
  tracks: Array<{
    id: string
    order: number
    height: number
    kind: 'video' | 'audio' | null
  }>,
  domTopByTrackId: ReadonlyMap<string, number>,
): Map<string, number> {
  const orderedTracks = [...tracks].sort((left, right) => left.order - right.order)
  const firstExistingIndex = orderedTracks.findIndex((track) => domTopByTrackId.has(track.id))
  if (firstExistingIndex === -1) {
    return new Map()
  }

  const topByTrackId = new Map<string, number>()
  const firstExistingTrack = orderedTracks[firstExistingIndex]!
  topByTrackId.set(firstExistingTrack.id, domTopByTrackId.get(firstExistingTrack.id)!)

  for (let index = firstExistingIndex - 1; index >= 0; index -= 1) {
    const currentTrack = orderedTracks[index]!
    const nextTrack = orderedTracks[index + 1]!
    const nextTop = topByTrackId.get(nextTrack.id)
    if (nextTop === undefined) continue
    const gap =
      currentTrack.kind === 'video' && nextTrack.kind === 'audio' ? TRACK_SECTION_DIVIDER_GAP : 0
    topByTrackId.set(currentTrack.id, nextTop - currentTrack.height - gap)
  }

  for (let index = firstExistingIndex + 1; index < orderedTracks.length; index += 1) {
    const previousTrack = orderedTracks[index - 1]!
    const currentTrack = orderedTracks[index]!
    const previousTop = topByTrackId.get(previousTrack.id)
    if (previousTop === undefined) continue
    const gap =
      previousTrack.kind === 'video' && currentTrack.kind === 'audio'
        ? TRACK_SECTION_DIVIDER_GAP
        : 0
    topByTrackId.set(currentTrack.id, previousTop + previousTrack.height + gap)
  }

  return topByTrackId
}

function setGlobalDragCursor(mode: DragCursorMode): void {
  const nextClass = DRAG_CURSOR_CLASS_BY_MODE[mode]
  if (document.body.classList.contains(nextClass)) {
    return
  }
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
  document.body.classList.add(nextClass)
}

function clearGlobalDragCursor(): void {
  document.body.classList.remove(...DRAG_CURSOR_CLASSES)
}

interface DraggedItemState {
  id: string
  initialFrame: number
  initialTrackId: string
}

type DragSelectionSnapshot = Pick<
  SelectionState,
  | 'selectedItemIds'
  | 'selectedItemIdSet'
  | 'selectedMarkerId'
  | 'selectedTransitionId'
  | 'selectedTrackId'
  | 'selectedTrackIds'
  | 'activeTrackId'
  | 'selectionType'
  | 'editKeyframePanelOpen'
  | 'expandedKeyframeLanes'
>

function captureDragSelectionSnapshot(state: SelectionState): DragSelectionSnapshot {
  return {
    selectedItemIds: [...state.selectedItemIds],
    selectedItemIdSet: new Set(state.selectedItemIdSet),
    selectedMarkerId: state.selectedMarkerId,
    selectedTransitionId: state.selectedTransitionId,
    selectedTrackId: state.selectedTrackId,
    selectedTrackIds: [...state.selectedTrackIds],
    activeTrackId: state.activeTrackId,
    selectionType: state.selectionType,
    editKeyframePanelOpen: state.editKeyframePanelOpen,
    expandedKeyframeLanes: new Set(state.expandedKeyframeLanes),
  }
}

function getEffectiveTrackStateById(tracks: TimelineTrack[]): ReadonlyMap<string, TimelineTrack> {
  return new Map(resolveEffectiveTrackStates(tracks).map((track) => [track.id, track]))
}

function areItemSourceTracksUnlocked(
  allItems: TimelineItem[],
  tracks: TimelineTrack[],
  itemIds: readonly string[],
): boolean {
  const itemById = new Map(allItems.map((currentItem) => [currentItem.id, currentItem]))
  const effectiveTrackById = getEffectiveTrackStateById(tracks)

  return itemIds.every((itemId) => {
    const sourceItem = itemById.get(itemId)
    const sourceTrack = sourceItem ? effectiveTrackById.get(sourceItem.trackId) : undefined
    return sourceTrack?.locked === false
  })
}

function areDestinationTracksUnlocked(
  tracks: TimelineTrack[],
  trackIds: readonly string[],
): boolean {
  const effectiveTrackById = getEffectiveTrackStateById(tracks)
  return trackIds.every((trackId) => effectiveTrackById.get(trackId)?.locked === false)
}

/**
 * Resolve the full set of items a drag should move and their initial positions:
 * expand the base selection (linked items when enabled, else the raw selection
 * or the just-clicked clip), attach captions, drop locked items, and snapshot
 * each survivor's starting frame + track. Linked cohorts reject the entire
 * gesture if any explicit or implicit member is on a locked track.
 */
function resolveDraggedItemStates(
  allItems: TimelineItem[],
  currentTracks: TimelineTrack[],
  currentSelectedIds: string[],
  isInSelection: boolean,
  linkedIds: string[],
  linkedSelectionEnabled: boolean,
): {
  baseItemsToDrag: string[]
  draggableItemIds: string[]
  draggedItems: DraggedItemState[]
  isLinkedCohort: boolean
  isBlockedByLockedLinkedItem: boolean
} {
  const baseItemsToDrag = isInSelection
    ? linkedSelectionEnabled
      ? expandSelectionWithLinkedItems(allItems, currentSelectedIds)
      : currentSelectedIds
    : linkedIds
  const itemsToDrag = expandItemIdsWithAttachedCaptions(allItems, baseItemsToDrag)
  const unlockedItemIds = filterUnlockedItemIds(
    allItems,
    resolveEffectiveTrackStates(currentTracks),
    itemsToDrag,
  )
  const isLinkedCohort = isLinkedDragCohort(allItems, itemsToDrag)
  const isBlockedByLockedLinkedItem =
    isLinkedCohort && unlockedItemIds.length !== itemsToDrag.length
  const draggableItemIds = isBlockedByLockedLinkedItem ? [] : unlockedItemIds
  const draggedItems = draggableItemIds
    .map((id) => {
      const dragItem = allItems.find((i) => i.id === id)
      if (!dragItem) return null
      return {
        id: dragItem.id,
        initialFrame: dragItem.from,
        initialTrackId: dragItem.trackId,
      }
    })
    .filter((i): i is DraggedItemState => i !== null)
  return {
    baseItemsToDrag,
    draggableItemIds,
    draggedItems,
    isLinkedCohort,
    isBlockedByLockedLinkedItem,
  }
}

/**
 * Timeline drag-and-drop hook - Phase 2 Enhanced
 *
 * Features:
 * - Single and multi-select drag
 * - Horizontal (time) and vertical (track) movement
 * - Grid + magnetic snapping (adaptive threshold)
 * - Collision detection with push-forward
 * - Undo/redo support (automatic via Zundo)
 *
 * @param item - The timeline item to make draggable
 * @param timelineDuration - Total timeline duration in seconds
 * @param trackLocked - Whether the track is locked (prevents dragging)
 */
export function useTimelineDrag(
  item: TimelineItem,
  timelineDuration: number,
  trackLocked: boolean = false,
  elementRef?: React.RefObject<HTMLDivElement | null>,
): UseTimelineDragReturn {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<DragState | null>(null)
  const isLinkedCohortDragRef = useRef(false)
  const dragVisualTopByTrackIdRef = useRef<Map<string, number>>(new Map())
  const linkedMovePreviewSignatureRef = useRef('')
  const selectionRollbackRef = useRef<DragSelectionSnapshot | null>(null)
  const gestureMovementRef = useRef(0)
  const removeDragThresholdListenersRef = useRef<(() => void) | null>(null)

  // Track Alt key state for duplication mode (dynamic toggle during drag)
  const isAltDragRef = useRef(false)

  // Track previous snap target to avoid unnecessary store updates
  const prevSnapTargetRef = useRef<{ frame: number; type: string } | null>(null)
  const magneticSnapTargetsRef = useRef<SnapTarget[]>([])

  // Get store actions with granular selectors
  const moveItem = useTimelineStore((s) => s.moveItem)
  const moveItems = useTimelineStore((s) => s.moveItems)
  const moveItemsWithTrackChanges = useTimelineStore((s) => s.moveItemsWithTrackChanges)
  const duplicateItems = useTimelineStore((s) => s.duplicateItems)
  const duplicateItemsWithTrackChanges = useTimelineStore((s) => s.duplicateItemsWithTrackChanges)
  const tracks = useTimelineStore((s) => s.tracks)
  // NOTE: Don't subscribe to items here! Every TimelineItem has this hook,
  // subscribing to items would cause ALL items to re-render when ANY item changes.
  // Instead, read items on-demand in callbacks using getState().

  // Selection store - use granular selectors to prevent re-renders
  // NOTE: dragState subscription removed - activeSnapTarget is read directly in timeline-content.tsx
  const selectItems = useSelectionStore((s) => s.selectItems)
  const setDragState = useSelectionStore((s) => s.setDragState)
  const setActiveSnapTarget = useSelectionStore((s) => s.setActiveSnapTarget)
  const setActiveLinkedDropTarget = useSelectionStore((s) => s.setActiveLinkedDropTarget)

  const clearLinkedMovePreview = useCallback(() => {
    if (linkedMovePreviewSignatureRef.current === '') {
      return
    }

    linkedMovePreviewSignatureRef.current = ''
    useLinkedEditPreviewStore.getState().clear()
  }, [])

  const setLinkedMovePreview = useCallback(
    (currentItems: TimelineItem[], movedItems: Array<{ id: string; from: number }>) => {
      const previewUpdates = buildLinkedMovePreviewUpdates(currentItems, movedItems)
      const signature = previewUpdates
        .map((update) => `${update.id}:${update.from ?? ''}`)
        .join('|')

      if (signature === linkedMovePreviewSignatureRef.current) {
        return
      }

      linkedMovePreviewSignatureRef.current = signature

      if (previewUpdates.length === 0) {
        useLinkedEditPreviewStore.getState().clear()
        return
      }

      useLinkedEditPreviewStore.getState().setUpdates(previewUpdates)
    },
    [],
  )

  const finishDragInteraction = useCallback(
    ({
      rollbackSelection,
      suppressPostGestureClick = false,
      updateReactState = true,
    }: {
      rollbackSelection: boolean
      suppressPostGestureClick?: boolean
      updateReactState?: boolean
    }) => {
      const removeDragThresholdListeners = removeDragThresholdListenersRef.current
      removeDragThresholdListenersRef.current = null
      removeDragThresholdListeners?.()

      if (elementRef?.current) {
        elementRef.current.style.transform = ''
      }
      dragOffsetRef.current = { x: 0, y: 0 }
      dragVisualTopByTrackIdRef.current.clear()
      dragPreviewOffsetByItemRef.current = {}
      clearLargeAltDragCanvas()
      clearLinkedMovePreview()
      prevSnapTargetRef.current = null
      magneticSnapTargetsRef.current = []
      dragStateRef.current = null
      isLinkedCohortDragRef.current = false
      isAltDragRef.current = false
      gestureMovementRef.current = 0
      clearGlobalDragCursor()
      document.body.style.userSelect = ''

      const selectionSnapshot = selectionRollbackRef.current
      selectionRollbackRef.current = null
      useSelectionStore.setState({
        ...(rollbackSelection && selectionSnapshot ? selectionSnapshot : {}),
        dragState: null,
        activeSnapTarget: null,
        activeLinkedDropTarget: null,
      })

      if (suppressPostGestureClick) {
        suppressPostTimelineGestureClick()
      }

      if (updateReactState) {
        setIsDragging(false)
        setDragOffset({ x: 0, y: 0 })
      }
    },
    [clearLinkedMovePreview, elementRef],
  )

  const trackRejectedDragAttempt = useCallback(
    (startMouseX: number, startMouseY: number) => {
      const handleMouseMove = (event: MouseEvent) => {
        gestureMovementRef.current = Math.max(
          gestureMovementRef.current,
          Math.abs(event.clientX - startMouseX),
          Math.abs(event.clientY - startMouseY),
        )
      }
      const handleMouseUp = () => {
        finishDragInteraction({
          rollbackSelection: true,
          suppressPostGestureClick: gestureMovementRef.current > 0,
        })
      }
      const handleCancellation = () => {
        finishDragInteraction({ rollbackSelection: true, suppressPostGestureClick: true })
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') handleCancellation()
      }
      const removeListeners = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('pointercancel', handleCancellation)
        window.removeEventListener('keydown', handleKeyDown)
        if (removeDragThresholdListenersRef.current === removeListeners) {
          removeDragThresholdListenersRef.current = null
        }
      }

      removeDragThresholdListenersRef.current = removeListeners
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('pointercancel', handleCancellation)
      window.addEventListener('keydown', handleKeyDown)
    },
    [finishDragInteraction],
  )

  // Get zoom utilities
  // Zoom conversions are read imperatively (via store.getState()) at call-time
  // to avoid subscribing every TimelineItem to the live zoom store.
  const pixelsToFramePrecise = pixelsToFramePreciseNow
  const frameToPixels = frameToPixelsNow

  // Build magnetic targets only after the drag threshold is crossed. The
  // gesture's actual cohort is excluded for moves; Alt-drag keeps originals.
  const { getMagneticSnapTargets, getSnapThresholdFrames, isSnapEnabled } = useSnapCalculator(
    timelineDuration,
    item.id,
    { includeTransitionMidpoints: false },
  )

  // Create stable refs to avoid stale closures in event listeners
  const frameToPixelsRef = useRef(frameToPixels)
  const pixelsToFramePreciseRef = useRef(pixelsToFramePrecise)
  const moveItemRef = useRef(moveItem)
  const moveItemsRef = useRef(moveItems)
  const moveItemsWithTrackChangesRef = useRef(moveItemsWithTrackChanges)
  const duplicateItemsRef = useRef(duplicateItems)
  const duplicateItemsWithTrackChangesRef = useRef(duplicateItemsWithTrackChanges)
  const tracksRef = useRef(tracks)

  // Helper to get items on-demand (avoids subscription that would cause all items to re-render)
  const getItems = useCallback(() => useTimelineStore.getState().items, [])
  // Update refs synchronously (not in useEffect) so they're always current
  const getSnapThresholdFramesRef = useRef(getSnapThresholdFrames)
  getSnapThresholdFramesRef.current = getSnapThresholdFrames

  // Update refs when dependencies change
  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    pixelsToFramePreciseRef.current = pixelsToFramePrecise
    moveItemRef.current = moveItem
    moveItemsRef.current = moveItems
    moveItemsWithTrackChangesRef.current = moveItemsWithTrackChanges
    duplicateItemsRef.current = duplicateItems
    duplicateItemsWithTrackChangesRef.current = duplicateItemsWithTrackChanges
    tracksRef.current = tracks
  }, [
    frameToPixels,
    pixelsToFramePrecise,
    moveItem,
    moveItems,
    moveItemsWithTrackChanges,
    duplicateItems,
    duplicateItemsWithTrackChanges,
    tracks,
  ])

  /**
   * Calculate which track the mouse is over based on Y position
   */
  const getTrackIdFromMouseY = useCallback((mouseY: number, startTrackId: string): string => {
    const container = document.querySelector('.timeline-container')
    const trackElements = (container ?? document).querySelectorAll('[data-track-id]')
    const tracks = tracksRef.current

    // Find track element under cursor
    for (const el of Array.from(trackElements)) {
      const rect = el.getBoundingClientRect()
      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const trackId = el.getAttribute('data-track-id')
        if (trackId) {
          return trackId
        }
      }
    }

    // Fallback to calculating by track height
    const startTrack = tracks.find((t) => t.id === startTrackId)
    if (!startTrack) return startTrackId

    const startTrackIndex = tracks.findIndex((t) => t.id === startTrackId)
    const trackHeight = startTrack.height || 64
    const deltaY = mouseY - (dragStateRef.current?.startMouseY || 0)
    const trackOffset = Math.round(deltaY / trackHeight)
    const newTrackIndex = Math.max(0, Math.min(tracks.length - 1, startTrackIndex + trackOffset))

    return tracks[newTrackIndex]?.id || startTrackId
  }, [])

  const getTrackDropTarget = useCallback(
    (
      mouseY: number,
      startTrackId: string,
    ): { trackId: string; zone: LinkedDragDropZone | null; createNew?: boolean } => {
      const trackContainer = document.querySelector('.timeline-tracks')
      const container = document.querySelector('.timeline-container')
      const trackElements = (trackContainer ?? container ?? document).querySelectorAll(
        '[data-track-id]',
      )
      const trackRows = Array.from(trackElements)
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .map((el) => ({
          el,
          rect: el.getBoundingClientRect(),
          trackId: el.getAttribute('data-track-id'),
        }))
        .filter((row): row is { el: HTMLElement; rect: DOMRect; trackId: string } => !!row.trackId)
        .sort((left, right) => left.rect.top - right.rect.top)

      const dragState = dragStateRef.current
      const startTrack = tracksRef.current.find((track) => track.id === startTrackId)
      const crossTrackThreshold = startTrack
        ? Math.max(CROSS_TRACK_SNAP_THRESHOLD_PX, Math.round(startTrack.height * 0.25))
        : CROSS_TRACK_SNAP_THRESHOLD_PX
      if (dragState && Math.abs(mouseY - dragState.startMouseY) < crossTrackThreshold) {
        return { trackId: startTrackId, zone: null }
      }

      const firstVideoTrack = tracksRef.current.find((track) => getTrackKind(track) === 'video')
      const lastAudioTrack = [...tracksRef.current]
        .reverse()
        .find((track) => getTrackKind(track) === 'audio')

      if (trackContainer instanceof HTMLElement && trackRows.length > 0) {
        const trackContainerRect = trackContainer.getBoundingClientRect()
        const firstRow = trackRows[0]!
        const lastRow = trackRows[trackRows.length - 1]!

        if (firstVideoTrack && mouseY >= trackContainerRect.top && mouseY < firstRow.rect.top) {
          return { trackId: firstVideoTrack.id, zone: 'video', createNew: true }
        }
        if (lastAudioTrack && mouseY > lastRow.rect.bottom && mouseY <= trackContainerRect.bottom) {
          return { trackId: lastAudioTrack.id, zone: 'audio', createNew: true }
        }
      }

      for (const row of trackRows) {
        const { rect, trackId } = row
        if (mouseY < rect.top || mouseY > rect.bottom) continue

        const hoveredTrack = tracksRef.current.find((track) => track.id === trackId)
        const hoveredKind = hoveredTrack ? getTrackKind(hoveredTrack) : null
        if (hoveredKind === 'video' || hoveredKind === 'audio') {
          return {
            trackId,
            createNew: false,
            zone: hoveredKind,
          }
        }

        return {
          trackId,
          zone: null,
        }
      }

      return {
        trackId: getTrackIdFromMouseY(mouseY, startTrackId),
        zone: null,
      }
    },
    [getTrackIdFromMouseY],
  )

  const getCompatibleTrackIdFromMouseY = useCallback(
    (mouseY: number, startTrackId: string, itemType: TimelineItem['type']): string | null => {
      const hoveredTrackId = getTrackIdFromMouseY(mouseY, startTrackId)
      const compatibleTrack = findCompatibleTrackForItemType({
        tracks: resolveEffectiveTrackStates(tracksRef.current),
        items: getItems(),
        itemType,
        preferredTrackId: hoveredTrackId,
        allowPreferredTrackFallback: false,
      })

      return compatibleTrack?.id ?? null
    },
    [getItems, getTrackIdFromMouseY],
  )

  /**
   * Calculate magnetic snap for item position (start and end edges)
   * Only snaps to other item edges, not grid lines
   */
  const calculateMagneticSnap = useCallback(
    (
      targetStartFrame: number,
      itemDurationInFrames: number,
    ): { snappedFrame: number; snapTarget: SnapTarget | null } => {
      const targets = magneticSnapTargetsRef.current
      const threshold = getSnapThresholdFramesRef.current()
      const enabled = isSnapEnabled()

      if (!enabled || targets.length === 0) {
        return { snappedFrame: targetStartFrame, snapTarget: null }
      }

      const targetEndFrame = targetStartFrame + itemDurationInFrames

      // Find nearest snap for start position
      let nearestStartTarget: SnapTarget | null = null
      let startDistance = threshold
      for (const target of targets) {
        const distance = Math.abs(targetStartFrame - target.frame)
        if (distance < startDistance) {
          nearestStartTarget = target
          startDistance = distance
        }
      }

      // Find nearest snap for end position
      let nearestEndTarget: SnapTarget | null = null
      let endDistance = threshold
      for (const target of targets) {
        const distance = Math.abs(targetEndFrame - target.frame)
        if (distance < endDistance) {
          nearestEndTarget = target
          endDistance = distance
        }
      }

      // Use the closer snap
      if (startDistance < endDistance && nearestStartTarget) {
        return { snappedFrame: nearestStartTarget.frame, snapTarget: nearestStartTarget }
      } else if (nearestEndTarget) {
        // Snap end, adjust start position
        return {
          snappedFrame: nearestEndTarget.frame - itemDurationInFrames,
          snapTarget: nearestEndTarget,
        }
      }

      return { snappedFrame: targetStartFrame, snapTarget: null }
    },
    [isSnapEnabled],
  )

  /**
   * Handle mouse down - start dragging
   */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (dragStateRef.current || selectionRollbackRef.current) return

      // Prevent if clicking on resize handles
      const target = e.target as HTMLElement
      if (target.classList.contains('cursor-ew-resize')) {
        return
      }

      const currentSelectionState = useSelectionStore.getState()
      selectionRollbackRef.current = captureDragSelectionSnapshot(currentSelectionState)
      gestureMovementRef.current = 0

      const allItems = getItems()
      const currentTracks = useTimelineStore.getState().tracks
      const anchorTrack = getEffectiveTrackStateById(currentTracks).get(item.trackId)

      // The caller supplies the rendered lock state, but re-read canonical
      // effective state so a child lane cannot bypass a locked Layer Group.
      if (trackLocked || !anchorTrack || anchorTrack.locked) {
        trackRejectedDragAttempt(e.clientX, e.clientY)
        return
      }

      e.stopPropagation()

      // Check if this item is in current selection
      const currentSelectedIds = currentSelectionState.selectedItemIds
      const isInSelection = currentSelectedIds.includes(item.id)

      const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled

      const linkedIds = linkedSelectionEnabled ? getLinkedItemIds(allItems, item.id) : [item.id]

      // Determine which items to drag and snapshot their initial positions
      const { baseItemsToDrag, draggedItems, isLinkedCohort, isBlockedByLockedLinkedItem } =
        resolveDraggedItemStates(
          allItems,
          currentTracks,
          currentSelectedIds,
          isInSelection,
          linkedIds,
          linkedSelectionEnabled,
        )
      if (isBlockedByLockedLinkedItem || draggedItems.length === 0) {
        isLinkedCohortDragRef.current = false
        trackRejectedDragAttempt(e.clientX, e.clientY)
        return
      }

      // Only mutate selection after the complete cohort passes source-lock
      // validation. A rejected linked gesture is otherwise not atomic.
      const isMultiSelectClick = e.ctrlKey || e.metaKey
      if (!isInSelection && !isMultiSelectClick) {
        selectItems(linkedIds)
      }

      // Compare cohort *contents*, not just lengths: a same-size but
      // differently-composed drag cohort (e.g. linked items swapped in) must
      // still re-sync the selection.
      const selectedIdSet = new Set(currentSelectedIds)
      const cohortMatchesSelection =
        baseItemsToDrag.length === selectedIdSet.size &&
        baseItemsToDrag.every((id) => selectedIdSet.has(id))
      if (isInSelection && !cohortMatchesSelection) {
        selectItems(baseItemsToDrag)
      }

      isLinkedCohortDragRef.current = isLinkedCohort

      // Initialize drag state
      dragStateRef.current = {
        itemId: item.id, // Anchor item
        startFrame: item.from,
        startTrackId: item.trackId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentMouseX: e.clientX,
        currentMouseY: e.clientY,
        draggedItems,
      }
      // Capture geometry before any selected clip receives a preview transform.
      // Relative track deltas stay stable during vertical scrolling, so pointer
      // moves can derive every preview offset without forcing layout again.
      dragVisualTopByTrackIdRef.current = captureTrackVisualTops()

      // Don't set cursor immediately - wait for drag threshold

      // Attach a temporary mousemove listener to detect drag threshold
      const checkDragThreshold = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const deltaX = e.clientX - dragStateRef.current.startMouseX
        const deltaY = e.clientY - dragStateRef.current.startMouseY
        gestureMovementRef.current = Math.max(
          gestureMovementRef.current,
          Math.abs(deltaX),
          Math.abs(deltaY),
        )

        // Check if we've moved enough to start dragging
        if (Math.abs(deltaX) > DRAG_THRESHOLD_PIXELS || Math.abs(deltaY) > DRAG_THRESHOLD_PIXELS) {
          // Start the drag - track Alt key state
          isAltDragRef.current = e.altKey
          setIsDragging(true)
          setGlobalDragCursor(e.altKey ? 'copy' : 'grabbing')
          document.body.style.userSelect = 'none'

          // Broadcast drag state to all selected items
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || []
          magneticSnapTargetsRef.current = getMagneticSnapTargets(e.altKey ? null : draggedIds)
          if (e.altKey) {
            startLargeAltDragCanvas(draggedIds)
          }
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: 0, y: 0 },
            isAltDrag: e.altKey,
          })
          setActiveSnapTarget(null)
          setActiveLinkedDropTarget(null)
          clearLinkedMovePreview()

          // Remove these listeners - the main useEffect will handle it now.
          removeDragThresholdListeners()
        }
      }

      const cancelDrag = () => {
        // A click released before the threshold is a cancelled drag attempt.
        finishDragInteraction({
          rollbackSelection: true,
          suppressPostGestureClick: gestureMovementRef.current > 0,
        })
      }

      const cancelDragExplicitly = () => {
        finishDragInteraction({ rollbackSelection: true, suppressPostGestureClick: true })
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') cancelDragExplicitly()
      }

      function removeDragThresholdListeners() {
        window.removeEventListener('mousemove', checkDragThreshold)
        window.removeEventListener('mouseup', cancelDrag)
        window.removeEventListener('pointercancel', cancelDragExplicitly)
        window.removeEventListener('keydown', handleKeyDown)
        if (removeDragThresholdListenersRef.current === removeDragThresholdListeners) {
          removeDragThresholdListenersRef.current = null
        }
      }

      removeDragThresholdListenersRef.current = removeDragThresholdListeners
      window.addEventListener('mousemove', checkDragThreshold)
      window.addEventListener('mouseup', cancelDrag)
      window.addEventListener('pointercancel', cancelDragExplicitly)
      window.addEventListener('keydown', handleKeyDown)
    },
    [
      clearLinkedMovePreview,
      finishDragInteraction,
      item.id,
      item.from,
      item.trackId,
      selectItems,
      trackLocked,
      setActiveLinkedDropTarget,
      setActiveSnapTarget,
      setDragState,
      getItems,
      getMagneticSnapTargets,
      trackRejectedDragAttempt,
    ],
  )

  /**
   * Handle mouse move - update drag position
   */
  useEffect(() => {
    if (!dragStateRef.current || !isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current) return

      const deltaX = e.clientX - dragStateRef.current.startMouseX
      const deltaY = e.clientY - dragStateRef.current.startMouseY

      // Dynamic Alt key toggle - update state and cursor
      const altKeyChanged = isAltDragRef.current !== e.altKey
      isAltDragRef.current = e.altKey
      if (altKeyChanged) {
        const draggedIds = dragStateRef.current.draggedItems.map((dragged) => dragged.id)
        magneticSnapTargetsRef.current = getMagneticSnapTargets(e.altKey ? null : draggedIds)
        if (e.altKey) {
          startLargeAltDragCanvas(draggedIds)
        } else {
          clearLargeAltDragCanvas()
        }
      }

      // Calculate clamped delta to prevent visual preview from going below frame 0
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)
      const draggedItems = dragStateRef.current.draggedItems

      // Find the minimum starting frame among all dragged items
      let minInitialFrame = Infinity
      for (const draggedItem of draggedItems) {
        if (draggedItem.initialFrame < minInitialFrame) {
          minInitialFrame = draggedItem.initialFrame
        }
      }

      // Calculate the maximum allowed negative deltaX (in pixels)
      // to prevent the earliest item from going below frame 0
      const maxNegativeDeltaFrames = -minInitialFrame
      const clampedDeltaFrames = Math.max(maxNegativeDeltaFrames, deltaFrames)

      // Convert back to pixels for the clamped X offset
      // Use the ratio of clamped to original to maintain precision
      const clampedDeltaX = deltaFrames !== 0 ? deltaX * (clampedDeltaFrames / deltaFrames) : deltaX

      const currentItems = getItems()
      const currentItemById = new Map(
        currentItems.map((currentItem) => [currentItem.id, currentItem]),
      )
      const currentItemsByTrackId = new Map<string, TimelineItem[]>()
      for (const currentItem of currentItems) {
        const trackItems = currentItemsByTrackId.get(currentItem.trackId)
        if (trackItems) {
          trackItems.push(currentItem)
        } else {
          currentItemsByTrackId.set(currentItem.trackId, [currentItem])
        }
      }
      const trackIndexById = new Map(
        tracksRef.current.map((currentTrack, index) => [currentTrack.id, index]),
      )
      const dropTarget = getTrackDropTarget(e.clientY, dragStateRef.current.startTrackId)
      const previewTrackResolution = resolveDraggedTrackTargets({
        items: currentItems,
        draggedItems: dragStateRef.current.draggedItems,
        anchorItemId: dragStateRef.current.itemId,
        isLinkedCohort: isLinkedCohortDragRef.current,
        tracks: tracksRef.current,
        dropTarget,
        preferredTrackHeight:
          tracksRef.current.find((track) => track.id === dropTarget.trackId)?.height ??
          tracksRef.current.find((track) => track.id === dragStateRef.current!.startTrackId)
            ?.height ??
          64,
      })
      const previewTrackTargets = previewTrackResolution.trackTargets
      const hoveredCompatibleTrackId = getCompatibleTrackIdFromMouseY(
        e.clientY,
        dragStateRef.current.startTrackId,
        item.type,
      )
      const hasInvalidExplicitDropTarget =
        dropTarget.zone !== null &&
        !previewTrackTargets &&
        (previewTrackResolution.isLinkedCohort || hoveredCompatibleTrackId === null)
      const linkedDropTarget =
        dropTarget.zone && !hasInvalidExplicitDropTarget
          ? { trackId: dropTarget.trackId, zone: dropTarget.zone, createNew: dropTarget.createNew }
          : null
      const previewAnchorTrackId =
        previewTrackTargets?.trackAssignments.get(dragStateRef.current.itemId) ??
        (previewTrackResolution.isLinkedCohort && dropTarget.zone
          ? null
          : hoveredCompatibleTrackId) ??
        dragStateRef.current.startTrackId
      dragStateRef.current.currentMouseX = e.clientX
      dragStateRef.current.currentMouseY = e.clientY

      setGlobalDragCursor(
        hasInvalidExplicitDropTarget ? 'not-allowed' : e.altKey ? 'copy' : 'grabbing',
      )

      // For multi-item drag, calculate group bounding box for snap visualization
      // Note: deltaFrames and draggedItems already calculated above for clamping
      let snapStartFrame: number
      let snapDuration: number

      let rawGroupStartFrame = 0

      if (draggedItems.length > 1) {
        // Calculate group bounds
        let groupStartFrame = Infinity
        let groupEndFrame = -Infinity

        for (const draggedItem of draggedItems) {
          const sourceItem = currentItemById.get(draggedItem.id)
          if (!sourceItem) continue

          const proposedStart = draggedItem.initialFrame + deltaFrames
          const proposedEnd = proposedStart + sourceItem.durationInFrames

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
        }

        rawGroupStartFrame = groupStartFrame
        snapStartFrame = Math.max(0, groupStartFrame)
        snapDuration = groupEndFrame - groupStartFrame
      } else {
        // Single item drag - use anchor item
        snapStartFrame = Math.max(0, dragStateRef.current.startFrame + deltaFrames)
        const draggedItem = currentItemById.get(dragStateRef.current.itemId)
        snapDuration = draggedItem?.durationInFrames || 0
      }

      const snapResult = calculateMagneticSnap(snapStartFrame, snapDuration)
      const previewVisualTopByTrackId = buildTrackVisualTopMap(
        (previewTrackTargets?.tracks ?? tracksRef.current).map((track) => ({
          id: track.id,
          order: track.order ?? 0,
          height: track.height,
          kind: getTrackKind(track),
        })),
        dragVisualTopByTrackIdRef.current,
      )
      let previewOffsets: Record<string, { x: number; y: number }> | null = null
      let anchorPreviewOffset = { x: clampedDeltaX, y: deltaY }
      let linkedPreviewMovedItems: Array<{ id: string; from: number }> = []

      if (draggedItems.length > 1) {
        const previewSnapDelta = snapDuration > 0 ? snapResult.snappedFrame - snapStartFrame : 0
        let minProposedFrame = Infinity

        for (const draggedItem of dragStateRef.current.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + previewSnapDelta
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart
          }
        }

        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0
        const previewMovedItems = dragStateRef.current.draggedItems
          .map((draggedItem) => {
            const sourceItem = currentItemById.get(draggedItem.id)
            if (!sourceItem) return null

            const itemNewTrackId = resolveMultiDragTrackId({
              draggedItem,
              trackTargets: previewTrackTargets,
              isLinkedCohort: previewTrackResolution.isLinkedCohort,
              dropZone: dropTarget.zone,
              trackIndexById,
              tracks: tracksRef.current,
              anchorTrackId: dragStateRef.current!.startTrackId,
              targetAnchorTrackId: previewAnchorTrackId,
            })
            if (!itemNewTrackId) return null

            return {
              id: draggedItem.id,
              initialFrame: draggedItem.initialFrame,
              initialTrackId: draggedItem.initialTrackId,
              newFrom: draggedItem.initialFrame + deltaFrames + previewSnapDelta + groupClampOffset,
              newTrackId: itemNewTrackId,
              durationInFrames: sourceItem.durationInFrames,
            }
          })
          .filter((previewItem) => previewItem !== null) as Array<{
          id: string
          initialFrame: number
          initialTrackId: string
          newFrom: number
          newTrackId: string
          durationInFrames: number
        }>

        // Resolve one offset against every destination lane. Per-item wall
        // clamps can move a previously clear member into another blocker.
        if (!isAltDragRef.current) {
          const groupExcludeIds = new Set(previewMovedItems.map((m) => m.id))
          const previewBlockers = currentItems.filter(
            (currentItem) => !groupExcludeIds.has(currentItem.id),
          )
          const sharedPreviewOffset = findNearestAvailableSharedOffset(
            previewMovedItems.map((previewItem) => ({
              trackId: previewItem.newTrackId,
              from: previewItem.newFrom,
              durationInFrames: previewItem.durationInFrames,
            })),
            previewBlockers,
          )
          if (sharedPreviewOffset !== null && sharedPreviewOffset !== 0) {
            for (const previewItem of previewMovedItems) {
              previewItem.newFrom += sharedPreviewOffset
            }
          }
        }

        previewOffsets = {}
        for (const previewItem of previewMovedItems) {
          const currentTop = previewVisualTopByTrackId.get(previewItem.initialTrackId)
          const targetTop = previewVisualTopByTrackId.get(previewItem.newTrackId)
          previewOffsets[previewItem.id] = {
            x: frameToPixelsRef.current(previewItem.newFrom - previewItem.initialFrame),
            y:
              currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
          }
        }
        linkedPreviewMovedItems = previewMovedItems.map((previewItem) => ({
          id: previewItem.id,
          from: previewItem.newFrom,
        }))

        anchorPreviewOffset = previewOffsets[dragStateRef.current.itemId] ?? {
          x: frameToPixelsRef.current(
            Math.max(0, rawGroupStartFrame + previewSnapDelta) - rawGroupStartFrame + deltaFrames,
          ),
          y: deltaY,
        }
      } else {
        const previewProposedFrame = Math.max(0, snapResult.snappedFrame)
        const previewTargetTrackId =
          previewTrackTargets?.trackAssignments.get(dragStateRef.current.itemId) ??
          previewAnchorTrackId
        // Clamp to track walls so the preview can't visually overlap other clips
        const dragExcludeIds = new Set(draggedItems.map((d) => d.id))
        const previewFinalFrame = isAltDragRef.current
          ? previewProposedFrame
          : clampToTrackWalls(
              previewProposedFrame,
              item.durationInFrames,
              previewTargetTrackId,
              dragExcludeIds,
              currentItems,
              currentItemsByTrackId,
            )
        const currentTop = previewVisualTopByTrackId.get(dragStateRef.current.startTrackId)
        const targetTop = previewVisualTopByTrackId.get(previewTargetTrackId)
        anchorPreviewOffset = {
          x: frameToPixelsRef.current(
            (previewFinalFrame ?? dragStateRef.current.startFrame) -
              dragStateRef.current.startFrame,
          ),
          y: currentTop !== undefined && targetTop !== undefined ? targetTop - currentTop : deltaY,
        }
        if (previewFinalFrame !== null) {
          linkedPreviewMovedItems = [{ id: dragStateRef.current.itemId, from: previewFinalFrame }]
        }
      }

      if (isAltDragRef.current) {
        clearLinkedMovePreview()
      } else {
        setLinkedMovePreview(currentItems, linkedPreviewMovedItems)
      }

      if (elementRef?.current && !isAltDragRef.current) {
        elementRef.current.style.transform = `translate(${anchorPreviewOffset.x}px, ${anchorPreviewOffset.y}px)`
      }

      dragOffsetRef.current = anchorPreviewOffset
      dragPreviewOffsetByItemRef.current = previewOffsets ?? {}
      if (isAltDragRef.current) {
        updateLargeAltDragCanvas(previewOffsets ?? {}, anchorPreviewOffset)
      }
      setDragOffset(anchorPreviewOffset)

      // Only update store when snap target or alt state actually changes to reduce re-renders
      const prevSnap = prevSnapTargetRef.current
      const newSnap = snapResult.snapTarget
      const prevLinkedDropTarget = useSelectionStore.getState().activeLinkedDropTarget
      const linkedDropChanged =
        (prevLinkedDropTarget === null && linkedDropTarget !== null) ||
        (prevLinkedDropTarget !== null && linkedDropTarget === null) ||
        (prevLinkedDropTarget !== null &&
          linkedDropTarget !== null &&
          (prevLinkedDropTarget.trackId !== linkedDropTarget.trackId ||
            prevLinkedDropTarget.zone !== linkedDropTarget.zone ||
            !!prevLinkedDropTarget.createNew !== !!linkedDropTarget.createNew))
      const snapChanged =
        (prevSnap === null && newSnap !== null) ||
        (prevSnap !== null && newSnap === null) ||
        (prevSnap !== null &&
          newSnap !== null &&
          (prevSnap.frame !== newSnap.frame || prevSnap.type !== newSnap.type))

      if (snapChanged || altKeyChanged || linkedDropChanged) {
        prevSnapTargetRef.current = newSnap ? { frame: newSnap.frame, type: newSnap.type } : null
        setActiveSnapTarget(snapResult.snapTarget)
        setActiveLinkedDropTarget(linkedDropTarget)
        if (altKeyChanged) {
          const draggedIds = dragStateRef.current?.draggedItems.map((item) => item.id) || []
          setDragState({
            isDragging: true,
            draggedItemIds: draggedIds,
            offset: { x: clampedDeltaX, y: deltaY },
            isAltDrag: e.altKey,
          })
        }
      }
    }

    const handleMouseUp = () => {
      if (!dragStateRef.current || !isDragging) return

      const dragState = dragStateRef.current
      const deltaX = dragState.currentMouseX - dragState.startMouseX
      const isAltDrag = isAltDragRef.current
      let dropAccepted = false

      // Calculate frame delta
      const deltaFrames = pixelsToFramePreciseRef.current(deltaX)

      const currentItems = getItems()
      const currentTracks = useTimelineStore.getState().tracks
      const hasLockedSource = !areItemSourceTracksUnlocked(
        currentItems,
        currentTracks,
        dragState.draggedItems.map((draggedItem) => draggedItem.id),
      )
      const dropTarget = getTrackDropTarget(dragState.currentMouseY, dragState.startTrackId)
      const resolvedTrackResolution = hasLockedSource
        ? { trackTargets: null, isLinkedCohort: isLinkedCohortDragRef.current }
        : resolveDraggedTrackTargets({
            items: currentItems,
            draggedItems: dragState.draggedItems,
            anchorItemId: dragState.itemId,
            isLinkedCohort: isLinkedCohortDragRef.current,
            tracks: currentTracks,
            dropTarget,
            preferredTrackHeight:
              currentTracks.find((track) => track.id === dropTarget.trackId)?.height ??
              currentTracks.find((track) => track.id === dragState.startTrackId)?.height ??
              64,
          })
      const resolvedTrackTargets = resolvedTrackResolution.trackTargets
      const hasIncompleteLinkedTrackTargets =
        resolvedTrackResolution.isLinkedCohort &&
        dropTarget.zone !== null &&
        (!resolvedTrackTargets ||
          dragState.draggedItems.some(
            (draggedItem) => !resolvedTrackTargets.trackAssignments.has(draggedItem.id),
          ))

      // Calculate new track for anchor item
      const newTrackId =
        hasLockedSource || hasIncompleteLinkedTrackTargets
          ? null
          : (resolvedTrackTargets?.trackAssignments.get(dragState.itemId) ??
            getCompatibleTrackIdFromMouseY(
              dragState.currentMouseY,
              dragState.startTrackId,
              item.type,
            ))

      // Multi-item drag or single?
      if (newTrackId === null) {
        logger.warn(
          hasLockedSource
            ? 'Cannot move items from a locked track'
            : 'Cannot move items to an incompatible track',
        )
      } else if (dragState.draggedItems.length > 1) {
        // Multi-item drag: calculate group bounding box for snapping
        // Snap should only happen at the edges of the entire selection, not individual items
        let groupStartFrame = Infinity
        let groupEndFrame = -Infinity

        for (const draggedItem of dragState.draggedItems) {
          const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
          if (!sourceItem) continue

          const proposedStart = draggedItem.initialFrame + deltaFrames
          const proposedEnd = proposedStart + sourceItem.durationInFrames

          if (proposedStart < groupStartFrame) groupStartFrame = proposedStart
          if (proposedEnd > groupEndFrame) groupEndFrame = proposedEnd
        }

        // Ensure valid bounds
        groupStartFrame = Math.max(0, groupStartFrame)
        const groupDuration = groupEndFrame - groupStartFrame

        // Calculate snap using the group's bounding box
        let snapDelta = 0
        if (groupDuration > 0) {
          const snapResult = calculateMagneticSnap(groupStartFrame, groupDuration)
          snapDelta = snapResult.snappedFrame - groupStartFrame
        }

        // Calculate how much we need to clamp the group to prevent any item going below frame 0
        // Find the minimum proposed start frame across all items
        let minProposedFrame = Infinity
        for (const draggedItem of dragState.draggedItems) {
          const proposedStart = draggedItem.initialFrame + deltaFrames + snapDelta
          if (proposedStart < minProposedFrame) {
            minProposedFrame = proposedStart
          }
        }

        // Calculate group clamp offset - if any item would go below 0, shift the whole group
        const groupClampOffset = minProposedFrame < 0 ? -minProposedFrame : 0
        const resolvedTrackIndexById = new Map(
          currentTracks.map((track, index) => [track.id, index]),
        )

        // Multi-item drag: calculate new positions for all items
        const movedItems = dragState.draggedItems
          .map((draggedItem) => {
            const sourceItem = currentItems.find((i) => i.id === draggedItem.id)
            if (!sourceItem) return null

            // Calculate new frame (maintain relative offset from anchor)
            // Apply frame delta, snap adjustment, AND group clamp offset to all items uniformly
            const newFrom = draggedItem.initialFrame + deltaFrames + snapDelta + groupClampOffset

            const itemNewTrackId = resolveMultiDragTrackId({
              draggedItem,
              trackTargets: resolvedTrackTargets,
              isLinkedCohort: resolvedTrackResolution.isLinkedCohort,
              dropZone: dropTarget.zone,
              trackIndexById: resolvedTrackIndexById,
              tracks: currentTracks,
              anchorTrackId: dragState.startTrackId,
              targetAnchorTrackId: newTrackId,
            })
            if (!itemNewTrackId) return null

            return {
              id: draggedItem.id,
              newFrom,
              newTrackId: itemNewTrackId,
              durationInFrames: sourceItem.durationInFrames,
            }
          })
          .filter((i) => i !== null) as Array<{
          id: string
          newFrom: number
          newTrackId: string
          durationInFrames: number
        }>

        const draggedItemIds = movedItems.map((m) => m.id)
        // For alt-drag (duplicate), include all items in collision check since originals stay in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => !draggedItemIds.includes(i.id))

        const destinationTracks = resolvedTrackTargets?.tracks ?? currentTracks
        const destinationsUnlocked = areDestinationTracksUnlocked(
          destinationTracks,
          movedItems.map((movedItem) => movedItem.newTrackId),
        )
        const groupSnapDelta = destinationsUnlocked
          ? findNearestAvailableSharedOffset(
              movedItems.map((movedItem) => ({
                trackId: movedItem.newTrackId,
                from: movedItem.newFrom,
                durationInFrames: movedItem.durationInFrames,
              })),
              itemsExcludingDragged,
            )
          : null

        if (groupSnapDelta === null) {
          logger.warn(
            destinationsUnlocked
              ? isAltDrag
                ? 'Cannot duplicate items: no available space'
                : 'Cannot move items: no available space'
              : 'Cannot move items to a locked track',
          )
        } else if (isAltDrag) {
          // ALT-DRAG: Duplicate items at new positions
          const itemIds = movedItems.map((m) => m.id)
          const positions = movedItems.map((m) => ({
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId: m.newTrackId,
          }))

          if (resolvedTrackTargets) {
            duplicateItemsWithTrackChangesRef.current(
              resolvedTrackTargets.tracks,
              itemIds,
              positions,
            )
          } else {
            duplicateItemsRef.current(itemIds, positions)
          }
          dropAccepted = true
        } else {
          // Normal drag: Apply the snap to ALL items in the group
          const allUpdates = movedItems.map((m) => ({
            id: m.id,
            from: Math.round(m.newFrom + groupSnapDelta),
            trackId:
              m.newTrackId !== currentItems.find((i) => i.id === m.id)?.trackId
                ? m.newTrackId
                : undefined,
          }))

          if (resolvedTrackTargets) {
            moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, allUpdates)
          } else {
            moveItemsRef.current(allUpdates)
          }
          dropAccepted = true
        }
      } else {
        // Single item drag
        let proposedFrame = Math.max(0, dragState.startFrame + deltaFrames)

        // Apply snapping
        const snapResult = calculateMagneticSnap(proposedFrame, item.durationInFrames)
        // Clamp after snapping to ensure we don't go below frame 0
        proposedFrame = Math.max(0, snapResult.snappedFrame)

        // Find nearest available space (snaps forward if collision)
        // For alt-drag, include the original item in collision check since it stays in place
        const itemsExcludingDragged = isAltDrag
          ? currentItems
          : currentItems.filter((i) => i.id !== item.id)
        const destinationTracks = resolvedTrackTargets?.tracks ?? currentTracks
        const destinationUnlocked = areDestinationTracksUnlocked(destinationTracks, [newTrackId])
        const finalFrame = destinationUnlocked
          ? findNearestAvailableSpace(
              proposedFrame,
              item.durationInFrames,
              newTrackId,
              itemsExcludingDragged,
            )
          : null

        if (finalFrame !== null) {
          const roundedFinalFrame = Math.round(finalFrame)
          if (isAltDrag) {
            // ALT-DRAG: Duplicate item at new position
            if (resolvedTrackTargets) {
              duplicateItemsWithTrackChangesRef.current(
                resolvedTrackTargets.tracks,
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            } else {
              duplicateItemsRef.current(
                [item.id],
                [{ from: roundedFinalFrame, trackId: newTrackId }],
              )
            }
            dropAccepted = true
          } else {
            // Normal drag: Move item
            const trackChanged = newTrackId !== dragState.startTrackId
            if (resolvedTrackTargets) {
              moveItemsWithTrackChangesRef.current(resolvedTrackTargets.tracks, [
                { id: item.id, from: roundedFinalFrame, trackId: newTrackId },
              ])
            } else {
              moveItemRef.current(item.id, roundedFinalFrame, trackChanged ? newTrackId : undefined)
            }
            dropAccepted = true
          }
        } else {
          // No space available - cancel drag (keep at original position)
          logger.warn(
            destinationUnlocked
              ? isAltDrag
                ? 'Cannot duplicate item: no available space'
                : 'Cannot move item: no available space'
              : 'Cannot move item to a locked track',
          )
        }
      }

      finishDragInteraction({
        rollbackSelection: !dropAccepted,
        suppressPostGestureClick: true,
      })
    }

    const handleCancellation = () => {
      finishDragInteraction({ rollbackSelection: true, suppressPostGestureClick: true })
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCancellation()
    }

    if (dragStateRef.current) {
      const coalescedMouseMove = createRafCoalescedCallback(handleMouseMove)
      const handleCoalescedMouseUp = () => {
        coalescedMouseMove.flush()
        handleMouseUp()
      }

      window.addEventListener('mousemove', coalescedMouseMove.queue)
      window.addEventListener('mouseup', handleCoalescedMouseUp)
      window.addEventListener('pointercancel', handleCancellation)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('mousemove', coalescedMouseMove.queue)
        window.removeEventListener('mouseup', handleCoalescedMouseUp)
        window.removeEventListener('pointercancel', handleCancellation)
        window.removeEventListener('keydown', handleKeyDown)
        coalescedMouseMove.cancel()
      }
    }
  }, [
    isDragging,
    item.id,
    item.durationInFrames,
    item.type,
    getCompatibleTrackIdFromMouseY,
    getTrackDropTarget,
    calculateMagneticSnap,
    getMagneticSnapTargets,
    clearLinkedMovePreview,
    finishDragInteraction,
    elementRef,
    getItems,
    setActiveLinkedDropTarget,
    setActiveSnapTarget,
    setDragState,
    setLinkedMovePreview,
  ])

  useEffect(
    () => () => {
      if (dragStateRef.current || selectionRollbackRef.current) {
        finishDragInteraction({
          rollbackSelection: true,
          suppressPostGestureClick: true,
          updateReactState: false,
        })
      }
    },
    [finishDragInteraction],
  )

  return {
    isDragging,
    dragOffset,
    handleDragStart,
  }
}
