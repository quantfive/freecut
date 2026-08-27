/**
 * Clipboard shortcuts: Ctrl+C (copy), Ctrl+X (cut), Ctrl+V (paste).
 */

import { useCommandHotkey } from '@/hooks/use-hotkey-registration'
import { toast } from 'sonner'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '../../stores/timeline-store'
import { useZoomStore } from '../../stores/zoom-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useCompositionNavigationStore } from '../../stores/composition-navigation-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import type { Transition } from '@/types/transition'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  isCompositionWrapperItem,
  wouldCreateCompositionCycle,
} from '../../utils/composition-graph'
import { handleTranscriptClipboardCopy } from '../../utils/transcript-copy-bridge'
import { createClassicTrack, getTrackKind } from '../../utils/classic-tracks'

interface PastePlacementPlan {
  itemData: Omit<TimelineItem, 'id'>
  targetTrackId: string
  desiredFrom: number
  sourceIndex: number
}

function placementsOverlap(
  left: { trackId: string; from: number; durationInFrames: number },
  right: { trackId: string; from: number; durationInFrames: number },
): boolean {
  return (
    left.trackId === right.trackId &&
    left.from < right.from + right.durationInFrames &&
    left.from + left.durationInFrames > right.from
  )
}

function hasInternalPlacementOverlap(plans: PastePlacementPlan[]): boolean {
  return plans.some((plan, index) =>
    plans.slice(index + 1).some((candidate) =>
      placementsOverlap(
        {
          trackId: plan.targetTrackId,
          from: plan.desiredFrom,
          durationInFrames: plan.itemData.durationInFrames,
        },
        {
          trackId: candidate.targetTrackId,
          from: candidate.desiredFrom,
          durationInFrames: candidate.itemData.durationInFrames,
        },
      ),
    ),
  )
}

type PasteTrackKind = 'video' | 'audio'

interface PasteSourceLane {
  key: string
  kind: PasteTrackKind
  sourceTrackId: string
  ordinal: number
}

function getPasteTrackKind(item: Omit<TimelineItem, 'id'>): PasteTrackKind {
  return item.type === 'audio' ? 'audio' : 'video'
}

function isCompatiblePasteTrack(track: TimelineTrack, kind: PasteTrackKind): boolean {
  const trackKind = getTrackKind(track)
  return kind === 'audio' ? trackKind === 'audio' : trackKind !== 'audio'
}

function getPasteDestinationTrackIds(tracks: TimelineTrack[], kind: PasteTrackKind): string[] {
  return tracks
    .filter((track) => !track.isGroup && isCompatiblePasteTrack(track, kind))
    .sort((left, right) => left.order - right.order)
    .map((track) => track.id)
}

function collectPasteSourceLanes(pasteItems: Array<Omit<TimelineItem, 'id'>>) {
  const lanesByKind: Record<PasteTrackKind, PasteSourceLane[]> = { video: [], audio: [] }
  const laneByKey = new Map<string, PasteSourceLane>()
  const laneKeyByItemIndex = new Map<number, string>()

  for (const [sourceIndex, itemData] of pasteItems.entries()) {
    const kind = getPasteTrackKind(itemData)
    const key = `${kind}:${itemData.trackId}`
    let lane = laneByKey.get(key)
    if (!lane) {
      lane = {
        key,
        kind,
        sourceTrackId: itemData.trackId,
        ordinal: lanesByKind[kind].length,
      }
      laneByKey.set(key, lane)
      lanesByKind[kind].push(lane)
    }
    laneKeyByItemIndex.set(sourceIndex, key)
  }

  return { lanesByKind, laneKeyByItemIndex }
}

function findExactPasteTrack(
  lane: PasteSourceLane,
  tracks: TimelineTrack[],
): TimelineTrack | undefined {
  return tracks.find(
    (track) => track.id === lane.sourceTrackId && isCompatiblePasteTrack(track, lane.kind),
  )
}

function appendPasteDestinationTrack(
  tracks: TimelineTrack[],
  kind: PasteTrackKind,
): { trackId: string; tracks: TimelineTrack[] } {
  const minOrder = Math.min(...tracks.map((track) => track.order), 0)
  const maxOrder = Math.max(...tracks.map((track) => track.order), 0)
  const newTrack = createClassicTrack({
    tracks,
    kind,
    order: kind === 'video' ? minOrder - 1 : maxOrder + 1,
  })
  return { trackId: newTrack.id, tracks: [...tracks, newTrack] }
}

function planSingleSourceSection(params: {
  activeTrackId: string | null
  kind: PasteTrackKind
  lanes: PasteSourceLane[]
  tracks: TimelineTrack[]
}): { assignments: Map<string, string>; tracks: TimelineTrack[] } {
  const { activeTrackId, kind, lanes } = params
  let plannedTracks = params.tracks
  const assignments = new Map<string, string>()
  const candidates = getPasteDestinationTrackIds(plannedTracks, kind)
  const activeTrack = plannedTracks.find(
    (track) => track.id === activeTrackId && isCompatiblePasteTrack(track, kind),
  )

  for (const lane of lanes) {
    let targetTrackId =
      activeTrack?.id ?? findExactPasteTrack(lane, plannedTracks)?.id ?? candidates[0]
    if (!targetTrackId) {
      const created = appendPasteDestinationTrack(plannedTracks, kind)
      plannedTracks = created.tracks
      targetTrackId = created.trackId
      candidates.push(created.trackId)
    }
    assignments.set(lane.key, targetTrackId)
  }

  return { assignments, tracks: plannedTracks }
}

function planPreservedSourceSection(params: {
  kind: PasteTrackKind
  lanes: PasteSourceLane[]
  tracks: TimelineTrack[]
}): { assignments: Map<string, string>; tracks: TimelineTrack[] } {
  const { kind, lanes } = params
  let plannedTracks = params.tracks
  const assignments = new Map<string, string>()
  const candidates = getPasteDestinationTrackIds(plannedTracks, kind)
  const usedTrackIds = new Set<string>()

  for (const lane of lanes) {
    const exactTrack = findExactPasteTrack(lane, plannedTracks)
    if (!exactTrack) continue
    assignments.set(lane.key, exactTrack.id)
    usedTrackIds.add(exactTrack.id)
  }

  for (const lane of lanes) {
    if (assignments.has(lane.key)) continue
    const ordinalCandidate = candidates[lane.ordinal]
    const availableCandidate =
      ordinalCandidate && !usedTrackIds.has(ordinalCandidate)
        ? ordinalCandidate
        : candidates.find((candidate) => !usedTrackIds.has(candidate))
    let targetTrackId = availableCandidate
    if (!targetTrackId) {
      const created = appendPasteDestinationTrack(plannedTracks, kind)
      plannedTracks = created.tracks
      targetTrackId = created.trackId
      candidates.push(created.trackId)
    }
    assignments.set(lane.key, targetTrackId)
    usedTrackIds.add(targetTrackId)
  }

  return { assignments, tracks: plannedTracks }
}

function buildPasteTrackPlan(
  pasteItems: Array<Omit<TimelineItem, 'id'>>,
  tracks: TimelineTrack[],
  activeTrackId: string | null,
): { plan: Map<number, string>; tracks: TimelineTrack[] } {
  let plannedTracks = tracks
  const { lanesByKind, laneKeyByItemIndex } = collectPasteSourceLanes(pasteItems)
  const preserveSourceTracks = new Set(pasteItems.map((item) => item.trackId)).size > 1
  const plan = new Map<number, string>()
  const assignedTrackBySourceLane = new Map<string, string>()

  for (const kind of ['video', 'audio'] as const) {
    const sectionPlan = preserveSourceTracks
      ? planPreservedSourceSection({ kind, lanes: lanesByKind[kind], tracks: plannedTracks })
      : planSingleSourceSection({
          activeTrackId,
          kind,
          lanes: lanesByKind[kind],
          tracks: plannedTracks,
        })
    plannedTracks = sectionPlan.tracks
    for (const [laneKey, trackId] of sectionPlan.assignments) {
      assignedTrackBySourceLane.set(laneKey, trackId)
    }
  }

  for (const [sourceIndex, laneKey] of laneKeyByItemIndex) {
    const targetTrackId = assignedTrackBySourceLane.get(laneKey)
    if (targetTrackId) plan.set(sourceIndex, targetTrackId)
  }

  return { plan, tracks: plannedTracks }
}

function findSharedPlacementShift(
  plans: PastePlacementPlan[],
  occupiedItems: TimelineItem[],
): number {
  let shift = 0
  while (true) {
    let requiredShift = 0
    for (const plan of plans) {
      const from = plan.desiredFrom + shift
      for (const occupied of occupiedItems) {
        if (
          placementsOverlap(
            {
              trackId: plan.targetTrackId,
              from,
              durationInFrames: plan.itemData.durationInFrames,
            },
            occupied,
          )
        ) {
          requiredShift = Math.max(requiredShift, occupied.from + occupied.durationInFrames - from)
        }
      }
    }
    if (requiredShift <= 0) return shift
    shift += requiredShift
  }
}

function revealPastedItems(itemIds: readonly string[]): void {
  if (itemIds.length === 0) {
    return
  }

  window.requestAnimationFrame(() => {
    const container = document.querySelector<HTMLElement>('.timeline-container')
    if (!container) {
      return
    }

    const { items, fps } = useTimelineStore.getState()
    const { pixelsPerSecond } = useZoomStore.getState()
    const pastedItems = items.filter((item) => itemIds.includes(item.id))
    if (pastedItems.length === 0 || fps <= 0) {
      return
    }

    const startPx = Math.min(...pastedItems.map((item) => (item.from / fps) * pixelsPerSecond))
    const endPx = Math.max(
      ...pastedItems.map((item) => ((item.from + item.durationInFrames) / fps) * pixelsPerSecond),
    )
    const padding = 48
    const viewLeft = container.scrollLeft
    const viewRight = container.scrollLeft + container.clientWidth

    if (startPx >= viewLeft + padding && endPx <= viewRight - padding) {
      return
    }

    let nextScrollLeft = container.scrollLeft
    if (startPx < viewLeft + padding) {
      nextScrollLeft = Math.max(0, startPx - padding)
    } else if (endPx > viewRight - padding) {
      nextScrollLeft = Math.max(0, endPx - container.clientWidth + padding)
    }

    container.scrollLeft = nextScrollLeft
  })
}

export function useClipboardShortcuts() {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId)
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const clearItemSelection = useSelectionStore((s) => s.clearItemSelection)
  const activeTrackId = useSelectionStore((s) => s.activeTrackId)
  const items = useTimelineStore((s) => s.items)
  const transitions = useTimelineStore((s) => s.transitions)
  const tracks = useTimelineStore((s) => s.tracks)
  const addItems = useTimelineStore((s) => s.addItems)
  const addItemsOnNewTracks = useTimelineStore((s) => s.addItemsOnNewTracks)
  const removeItems = useTimelineStore((s) => s.removeItems)
  const updateTransition = useTimelineStore((s) => s.updateTransition)
  const copyTransition = useClipboardStore((s) => s.copyTransition)
  const transitionClipboard = useClipboardStore((s) => s.transitionClipboard)
  const copyItems = useClipboardStore((s) => s.copyItems)
  const itemsClipboard = useClipboardStore((s) => s.itemsClipboard)
  const clipboardHotkeyOptions = {
    ...HOTKEY_OPTIONS,
    eventListenerOptions: { capture: true } as const,
  }

  // Clipboard: Ctrl+C - Copy selected transition properties or timeline items
  useCommandHotkey(
    'COPY',
    (event) => {
      // Transcript editor copies the selected words instead of the clip.
      if (handleTranscriptClipboardCopy(false)) {
        event.preventDefault()
        return
      }
      if (selectedTransitionId) {
        event.preventDefault()
        const transition = transitions.find((t: Transition) => t.id === selectedTransitionId)
        if (transition) {
          copyTransition({
            presentation: transition.presentation,
            direction: transition.direction,
            timing: transition.timing,
            durationInFrames: transition.durationInFrames,
          })
          toast.success('Copied transition settings')
        }
        return
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault()
        const currentFrame = usePlaybackStore.getState().currentFrame
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id))
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'copy')
          toast.success(
            selectedItems.length === 1 ? 'Copied 1 item' : `Copied ${selectedItems.length} items`,
          )
        }
      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [
      selectedTransitionId,
      transitions,
      copyTransition,
      selectedItemIds,
      items,
      copyItems,
      selectedKeyframes.length,
    ],
  )

  // Clipboard: Ctrl+X - Cut selected items immediately
  useCommandHotkey(
    'CUT',
    (event) => {
      // Transcript editor cuts the selected words instead of the clip.
      if (handleTranscriptClipboardCopy(true)) {
        event.preventDefault()
        return
      }
      if (selectedItemIds.length > 0) {
        event.preventDefault()
        const currentFrame = usePlaybackStore.getState().currentFrame
        const selectedItems = items.filter((item) => selectedItemIds.includes(item.id))
        if (selectedItems.length > 0) {
          copyItems(selectedItems, currentFrame, 'cut')
          removeItems(selectedItemIds)
          clearItemSelection()
          toast.success(
            selectedItems.length === 1 ? 'Cut 1 item' : `Cut ${selectedItems.length} items`,
          )
        }
      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [selectedItemIds, items, copyItems, removeItems, clearItemSelection, selectedKeyframes.length],
  )

  // Clipboard: Ctrl+V - Paste transition properties or timeline items
  useCommandHotkey(
    'PASTE',
    (event) => {
      if (selectedTransitionId && transitionClipboard) {
        event.preventDefault()
        updateTransition(selectedTransitionId, {
          presentation: transitionClipboard.presentation,
          direction: transitionClipboard.direction,
          timing: transitionClipboard.timing,
          durationInFrames: transitionClipboard.durationInFrames,
        })
        toast.success('Pasted transition settings')
        return
      }
      if (itemsClipboard && itemsClipboard.items.length > 0) {
        event.preventDefault()
        const currentFrame = usePlaybackStore.getState().currentFrame
        const storeItems = useTimelineStore.getState().items
        const newItemIds: string[] = []
        const newItems: TimelineItem[] = []
        const usedTrackIds = new Set<string>()
        const linkedGroupMap = new Map<string, string>()

        const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
        const compositionById = useCompositionsStore.getState().compositionById
        const pasteItems =
          activeCompositionId === null
            ? itemsClipboard.items
            : itemsClipboard.items.filter(
                (item) =>
                  !isCompositionWrapperItem(item as TimelineItem) ||
                  !wouldCreateCompositionCycle({
                    parentCompositionId: activeCompositionId,
                    insertedCompositionId: (item as { compositionId: string }).compositionId,
                    compositionById,
                  }),
              )
        if (pasteItems.length === 0) return

        // Resolve every source lane by media section/kind. Exact IDs win when
        // they survive in this sequence; otherwise the source lane ordinal is
        // mapped to the corresponding destination lane. This keeps linked A/V
        // members in separate sections even when both source IDs are absent.
        const { plan: trackPlan, tracks: plannedTracks } = buildPasteTrackPlan(
          pasteItems,
          tracks,
          activeTrackId,
        )
        const placementPlans = pasteItems.flatMap((itemData, sourceIndex) => {
          const targetTrackId = trackPlan.get(sourceIndex)
          return targetTrackId
            ? [
                {
                  itemData,
                  targetTrackId,
                  desiredFrom: currentFrame + itemData.from,
                  sourceIndex,
                },
              ]
            : []
        })

        // Keep an ordinary multi-item paste as one rigid block. If invalid or
        // missing source tracks collapse overlapping items onto one target,
        // fall back to linked groups/singletons so placement can still make
        // progress without separating a valid linked A/V pair.
        let placementGroups: PastePlacementPlan[][] = [placementPlans]
        if (hasInternalPlacementOverlap(placementPlans)) {
          const grouped = new Map<string, PastePlacementPlan[]>()
          for (const plan of placementPlans) {
            const key = plan.itemData.linkedGroupId
              ? `linked:${plan.itemData.linkedGroupId}`
              : `item:${plan.sourceIndex}`
            const group = grouped.get(key) ?? []
            group.push(plan)
            grouped.set(key, group)
          }
          placementGroups = [...grouped.values()].flatMap((group) =>
            hasInternalPlacementOverlap(group) ? group.map((plan) => [plan]) : [group],
          )
        }

        const occupiedItems = [...storeItems]
        for (const group of placementGroups) {
          const sharedShift = findSharedPlacementShift(group, occupiedItems)
          for (const plan of group) {
            const { itemData, targetTrackId, desiredFrom } = plan
            const newId = crypto.randomUUID()
            newItemIds.push(newId)
            const newItem = {
              ...itemData,
              id: newId,
              from: desiredFrom + sharedShift,
              trackId: targetTrackId,
              originId: newId,
              linkedGroupId: itemData.linkedGroupId
                ? (linkedGroupMap.get(itemData.linkedGroupId) ??
                  linkedGroupMap
                    .set(itemData.linkedGroupId, crypto.randomUUID())
                    .get(itemData.linkedGroupId))
                : undefined,
            } as TimelineItem

            newItems.push(newItem)
            occupiedItems.push(newItem)
            usedTrackIds.add(targetTrackId)
          }
        }

        // Add every pasted item in a single ADD_ITEMS command so one Ctrl+Z
        // undoes the whole paste (including a linked A/V pair), not item-by-item.
        if (newItems.length > 0) {
          if (plannedTracks.length > tracks.length) {
            addItemsOnNewTracks(newItems, plannedTracks)
          } else {
            addItems(newItems)
          }
        }

        if (newItemIds.length > 0) {
          selectItems(newItemIds)
          revealPastedItems(newItemIds)
          const activeTrack = activeTrackId
            ? tracks.find((track) => track.id === activeTrackId)
            : null
          const usedTracks = tracks.filter((track) => usedTrackIds.has(track.id))
          const pasteTitle =
            newItemIds.length === 1 ? 'Pasted 1 item' : `Pasted ${newItemIds.length} items`

          if (activeTrack) {
            toast.success(pasteTitle, {
              description: `Active Track: ${activeTrack.name.replace(/^Track\s+/i, '')}`,
            })
          } else if (usedTracks.length === 1) {
            toast.success(pasteTitle, {
              description: `Track: ${usedTracks[0]!.name.replace(/^Track\s+/i, '')}`,
            })
          } else {
            toast.success(pasteTitle)
          }

          if (itemsClipboard.copyType === 'cut') {
            useClipboardStore.getState().clearItemsClipboard()
          }
        }
      }
    },
    { ...clipboardHotkeyOptions, enabled: selectedKeyframes.length === 0 },
    [
      selectedTransitionId,
      transitionClipboard,
      updateTransition,
      itemsClipboard,
      tracks,
      addItems,
      addItemsOnNewTracks,
      selectItems,
      activeTrackId,
      selectedKeyframes.length,
    ],
  )
}
