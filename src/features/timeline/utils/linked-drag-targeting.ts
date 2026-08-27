import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  createClassicTrack,
  getTrackKind,
  renameTrackForKind,
  type TrackKind,
} from './classic-tracks'

export type LinkedDragDropZone = 'video' | 'audio'

interface EnsureTrackIndexParams {
  tracks: TimelineTrack[]
  kind: TrackKind
  index: number
  preferredTrackHeight: number
}

export interface LinkedDragTrackTargetResult {
  tracks: TimelineTrack[]
  videoTrackId: string
  audioTrackId: string
}

export interface CreateNewDragTrackItem {
  id: string
  initialTrackId: string
  type: TimelineItem['type']
}

export interface CreateNewDragTrackTargetResult {
  tracks: TimelineTrack[]
  trackAssignments: Map<string, string>
}

export interface LinkedDragCohortItem {
  id: string
  initialTrackId: string
  type: TimelineItem['type']
}

export interface LinkedDragCohortTrackTargetResult {
  tracks: TimelineTrack[]
  trackAssignments: Map<string, string>
}

function getKindTracks(tracks: TimelineTrack[], kind: TrackKind): TimelineTrack[] {
  return [...tracks]
    .filter((track) => getTrackKind(track) === kind)
    .sort((left, right) => left.order - right.order)
}

function getClassicTrackNumber(track: TimelineTrack, kind: TrackKind): number | null {
  const prefix = kind === 'video' ? 'V' : 'A'
  const match = track.name.match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  if (!match?.[1]) {
    return null
  }

  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

function getTrackNumberIndex(tracks: TimelineTrack[], kind: TrackKind, trackId: string): number {
  return getKindTracks(tracks, kind).findIndex((track) => track.id === trackId)
}

function getNextSectionOrder(tracks: TimelineTrack[], kind: TrackKind): number {
  const sortedTracks = [...tracks].sort((left, right) => left.order - right.order)
  const kindTracks = getKindTracks(sortedTracks, kind)

  if (kind === 'video') {
    const lastVideoTrack = kindTracks[kindTracks.length - 1]
    const firstAudioTrack = getKindTracks(sortedTracks, 'audio')[0]

    if (lastVideoTrack && firstAudioTrack) {
      return (lastVideoTrack.order + firstAudioTrack.order) / 2
    }
    if (lastVideoTrack) {
      return lastVideoTrack.order + 1
    }
    if (firstAudioTrack) {
      return firstAudioTrack.order - 1
    }
    return 0
  }

  const lastAudioTrack = kindTracks[kindTracks.length - 1]
  if (lastAudioTrack) {
    return lastAudioTrack.order + 1
  }

  const lastVideoTrack = getKindTracks(sortedTracks, 'video').at(-1)
  return lastVideoTrack ? lastVideoTrack.order + 1 : 1
}

function getCreateNewTrackOrder(tracks: TimelineTrack[], kind: TrackKind): number {
  if (kind === 'video') {
    const firstVideoTrack = getKindTracks(tracks, 'video')[0]
    const firstAudioTrack = getKindTracks(tracks, 'audio')[0]
    if (firstVideoTrack) return firstVideoTrack.order - 1
    if (firstAudioTrack) return firstAudioTrack.order - 1
    return 0
  }

  const lastAudioTrack = getKindTracks(tracks, 'audio').at(-1)
  const lastVideoTrack = getKindTracks(tracks, 'video').at(-1)
  if (lastAudioTrack) return lastAudioTrack.order + 1
  if (lastVideoTrack) return lastVideoTrack.order + 1
  return 1
}

function addCreateNewTrack(params: {
  tracks: TimelineTrack[]
  kind: TrackKind
  preferredTrackHeight: number
}): TimelineTrack[] {
  const createdTrack = createClassicTrack({
    tracks: params.tracks,
    kind: params.kind,
    order: getCreateNewTrackOrder(params.tracks, params.kind),
    height: params.preferredTrackHeight,
  })
  return [...params.tracks, createdTrack]
}

function getDraggedItemTrackKind(type: TimelineItem['type']): TrackKind {
  return type === 'audio' ? 'audio' : 'video'
}

/**
 * Return lanes in section order, starting at the A/V divider and moving
 * outward. Video order is therefore the reverse of its visual top-to-bottom
 * order, while audio order already starts at the divider.
 */
function getSectionTracks(tracks: TimelineTrack[], kind: TrackKind): TimelineTrack[] {
  const kindTracks = getKindTracks(tracks, kind)
  return kind === 'video' ? kindTracks.reverse() : kindTracks
}

function getTrackSectionIndex(tracks: TimelineTrack[], kind: TrackKind, trackId: string): number {
  return getSectionTracks(tracks, kind).findIndex((track) => track.id === trackId)
}

function ensureTrackSectionIndex(params: EnsureTrackIndexParams): {
  tracks: TimelineTrack[]
  trackId: string
} {
  const { kind, index, preferredTrackHeight } = params
  let workingTracks = [...params.tracks]

  while (getSectionTracks(workingTracks, kind).length <= index) {
    workingTracks = addCreateNewTrack({
      tracks: workingTracks,
      kind,
      preferredTrackHeight,
    })
  }

  return {
    tracks: workingTracks,
    trackId: getSectionTracks(workingTracks, kind)[index]!.id,
  }
}

interface CohortTrackPlan {
  item: LinkedDragCohortItem
  kind: TrackKind
  sourceSection: number
}

interface CohortTrackPlanState {
  tracks: TimelineTrack[]
  plans: CohortTrackPlan[]
}

function upgradeCohortSourceTracks(
  tracks: TimelineTrack[],
  draggedItems: LinkedDragCohortItem[],
): TimelineTrack[] | null {
  let workingTracks = [...tracks]
  for (const draggedItem of draggedItems) {
    const kind = getDraggedItemTrackKind(draggedItem.type)
    const sourceTrack = workingTracks.find((track) => track.id === draggedItem.initialTrackId)
    if (!sourceTrack || sourceTrack.isGroup || sourceTrack.locked) return null

    const sourceKind = getTrackKind(sourceTrack)
    if (sourceKind !== null && sourceKind !== kind) return null
    if (sourceKind === null) {
      const upgradedTrack = renameTrackForKind(sourceTrack, workingTracks, kind)
      workingTracks = workingTracks.map((track) =>
        track.id === sourceTrack.id ? upgradedTrack : track,
      )
    }
  }

  return workingTracks
}

function createCohortTrackPlans(
  tracks: TimelineTrack[],
  draggedItems: LinkedDragCohortItem[],
): CohortTrackPlan[] | null {
  const plans: CohortTrackPlan[] = []
  for (const draggedItem of draggedItems) {
    const kind = getDraggedItemTrackKind(draggedItem.type)
    const sourceSection = getTrackSectionIndex(tracks, kind, draggedItem.initialTrackId)
    if (sourceSection < 0) return null
    plans.push({ item: draggedItem, kind, sourceSection })
  }

  return plans
}

function buildCohortTrackPlans(
  tracks: TimelineTrack[],
  draggedItems: LinkedDragCohortItem[],
): CohortTrackPlanState | null {
  if (draggedItems.length === 0) return null

  const workingTracks = upgradeCohortSourceTracks(tracks, draggedItems)
  if (!workingTracks) return null

  const plans = createCohortTrackPlans(workingTracks, draggedItems)
  if (!plans) return null

  return { tracks: workingTracks, plans }
}

function getSourceAnchorSection(params: {
  plans: CohortTrackPlan[]
  zoneKind: TrackKind
  anchorItemId: string
  anchorRelatedItemIds: readonly string[]
}): number | null {
  const relatedIds = new Set([params.anchorItemId, ...params.anchorRelatedItemIds])
  const anchorPlan = params.plans.find(
    (plan) => plan.item.id === params.anchorItemId && plan.kind === params.zoneKind,
  )
  const relatedZonePlan = params.plans.find(
    (plan) => relatedIds.has(plan.item.id) && plan.kind === params.zoneKind,
  )
  const fallbackAnchorPlan = params.plans.find((plan) => plan.item.id === params.anchorItemId)

  return (
    anchorPlan?.sourceSection ??
    relatedZonePlan?.sourceSection ??
    fallbackAnchorPlan?.sourceSection ??
    null
  )
}

function resolveExistingCohortDrop(params: {
  tracks: TimelineTrack[]
  plans: CohortTrackPlan[]
  zoneKind: TrackKind
  anchorItemId: string
  anchorRelatedItemIds: readonly string[]
  hoveredTrackId: string
}): { tracks: TimelineTrack[]; sectionDelta: number } | null {
  let workingTracks = params.tracks
  let hoveredTrack = workingTracks.find((track) => track.id === params.hoveredTrackId)
  if (!hoveredTrack || hoveredTrack.isGroup) return null

  let hoveredKind = getTrackKind(hoveredTrack)
  if (hoveredKind === null) {
    if (hoveredTrack.locked) return null
    const upgradedTrack = renameTrackForKind(hoveredTrack, workingTracks, params.zoneKind)
    workingTracks = workingTracks.map((track) =>
      track.id === hoveredTrack!.id ? upgradedTrack : track,
    )
    hoveredTrack = upgradedTrack
    hoveredKind = params.zoneKind
  }

  const targetSection = getTrackSectionIndex(workingTracks, hoveredKind, hoveredTrack.id)
  const sourceAnchorSection = getSourceAnchorSection(params)
  if (targetSection < 0 || sourceAnchorSection === null) return null

  return {
    tracks: workingTracks,
    sectionDelta: targetSection - sourceAnchorSection,
  }
}

function getCreateNewCohortSectionDelta(
  tracks: TimelineTrack[],
  plans: CohortTrackPlan[],
  zoneKind: TrackKind,
): number | null {
  const zonePlans = plans.filter((plan) => plan.kind === zoneKind)
  if (zonePlans.length === 0) return null

  const outermostSourceSection = Math.max(...zonePlans.map((plan) => plan.sourceSection))
  return getSectionTracks(tracks, zoneKind).length - outermostSourceSection
}

function assignCohortTrackTargets(params: {
  tracks: TimelineTrack[]
  plans: CohortTrackPlan[]
  sectionDelta: number
  preferredTrackHeight: number
}): LinkedDragCohortTrackTargetResult | null {
  let workingTracks = params.tracks
  const targetTrackIdBySource = new Map<string, string>()
  const sourcePlans = Array.from(
    new Map(
      params.plans.map((plan) => [
        `${plan.kind}:${plan.item.initialTrackId}`,
        {
          key: `${plan.kind}:${plan.item.initialTrackId}`,
          kind: plan.kind,
          targetSection: plan.sourceSection + params.sectionDelta,
        },
      ]),
    ).values(),
  ).sort((left, right) => left.targetSection - right.targetSection)

  for (const sourcePlan of sourcePlans) {
    const ensuredTrack = ensureTrackSectionIndex({
      tracks: workingTracks,
      kind: sourcePlan.kind,
      index: sourcePlan.targetSection,
      preferredTrackHeight: params.preferredTrackHeight,
    })
    workingTracks = ensuredTrack.tracks

    const targetTrack = workingTracks.find((track) => track.id === ensuredTrack.trackId)
    if (!targetTrack || targetTrack.locked) return null
    targetTrackIdBySource.set(sourcePlan.key, targetTrack.id)
  }

  const trackAssignments = new Map<string, string>()
  for (const plan of params.plans) {
    const targetTrackId = targetTrackIdBySource.get(`${plan.kind}:${plan.item.initialTrackId}`)
    if (!targetTrackId) return null
    trackAssignments.set(plan.item.id, targetTrackId)
  }

  return { tracks: workingTracks, trackAssignments }
}

/**
 * Resolve every member of a linked drag cohort by media section instead of by
 * raw global track index. The same section delta is applied to video, audio,
 * and attached visual items, preserving relative lane relationships while
 * keeping each item in a compatible media section.
 */
export function resolveLinkedCohortDragTrackTargets(params: {
  tracks: TimelineTrack[]
  draggedItems: LinkedDragCohortItem[]
  anchorItemId: string
  anchorRelatedItemIds?: readonly string[]
  hoveredTrackId: string
  zone: LinkedDragDropZone
  createNew?: boolean
  preferredTrackHeight: number
}): LinkedDragCohortTrackTargetResult | null {
  const {
    tracks,
    draggedItems,
    anchorItemId,
    anchorRelatedItemIds = [],
    hoveredTrackId,
    zone,
    createNew = false,
    preferredTrackHeight,
  } = params
  const planState = buildCohortTrackPlans(tracks, draggedItems)
  if (!planState) return null

  const { plans } = planState
  const zoneKind: TrackKind = zone
  const dropState = createNew
    ? {
        tracks: planState.tracks,
        sectionDelta: getCreateNewCohortSectionDelta(planState.tracks, plans, zoneKind),
      }
    : resolveExistingCohortDrop({
        tracks: planState.tracks,
        plans,
        zoneKind,
        anchorItemId,
        anchorRelatedItemIds,
        hoveredTrackId,
      })
  if (!dropState || dropState.sectionDelta === null) return null

  const innermostSourceSection = Math.min(...plans.map((plan) => plan.sourceSection))
  const sectionDelta = Math.max(dropState.sectionDelta, -innermostSourceSection)

  return assignCohortTrackTargets({
    tracks: dropState.tracks,
    plans,
    sectionDelta,
    preferredTrackHeight,
  })
}

function buildContiguousTrackAssignment(params: {
  sourceTrackIds: string[]
  targetTracks: TimelineTrack[]
  zone: LinkedDragDropZone
}): Map<string, string> {
  const targetAssignments = new Map<string, string>()
  if (params.sourceTrackIds.length === 0 || params.targetTracks.length === 0) {
    return targetAssignments
  }

  const startIndex =
    params.zone === 'video'
      ? 0
      : Math.max(0, params.targetTracks.length - params.sourceTrackIds.length)

  params.sourceTrackIds.forEach((trackId, index) => {
    const targetTrack =
      params.targetTracks[startIndex + index] ??
      params.targetTracks[params.zone === 'video' ? params.targetTracks.length - 1 : 0]
    if (targetTrack) {
      targetAssignments.set(trackId, targetTrack.id)
    }
  })

  return targetAssignments
}

export function resolveCreateNewDragTrackTargets(params: {
  tracks: TimelineTrack[]
  draggedItems: CreateNewDragTrackItem[]
  zone: LinkedDragDropZone
  preferredTrackHeight: number
}): CreateNewDragTrackTargetResult | null {
  const { tracks, draggedItems, zone, preferredTrackHeight } = params
  if (draggedItems.length === 0) {
    return null
  }

  const selectionKinds = Array.from(
    new Set(draggedItems.map((item) => getDraggedItemTrackKind(item.type))),
  )
  if (selectionKinds.length !== 1) {
    return null
  }

  const kind = selectionKinds[0]!
  if (zone !== kind) {
    return null
  }

  let workingTracks = [...tracks]
  const sourceTrackIds = Array.from(new Set(draggedItems.map((item) => item.initialTrackId)))
  const existingKindTrackCount = getKindTracks(workingTracks, kind).length
  const tracksToCreate = Math.max(1, sourceTrackIds.length - existingKindTrackCount)

  for (let index = 0; index < tracksToCreate; index += 1) {
    workingTracks = addCreateNewTrack({
      tracks: workingTracks,
      kind,
      preferredTrackHeight,
    })
  }

  const targetKindTracks = getKindTracks(workingTracks, kind)
  const sourceTracks = sourceTrackIds
    .map((trackId) => tracks.find((track) => track.id === trackId))
    .filter((track): track is TimelineTrack => track !== undefined)
    .sort((left, right) => left.order - right.order)
  const sourceTrackAssignments = new Map<string, string>()

  const canPreserveSectionOffsets =
    sourceTracks.length === sourceTrackIds.length &&
    sourceTracks.every((track) => getTrackKind(track) === kind)

  if (canPreserveSectionOffsets) {
    const sourceIndices = sourceTracks.map((track) => getTrackNumberIndex(tracks, kind, track.id))
    const hasValidIndices = sourceIndices.every((index) => index >= 0)

    if (hasValidIndices) {
      if (zone === 'video') {
        const topSelectedIndex = Math.min(...sourceIndices)
        sourceTracks.forEach((track, index) => {
          const targetTrack = targetKindTracks[sourceIndices[index]! - topSelectedIndex]
          if (targetTrack) {
            sourceTrackAssignments.set(track.id, targetTrack.id)
          }
        })
      } else {
        const bottomSelectedIndex = Math.max(...sourceIndices)
        const lastTargetIndex = targetKindTracks.length - 1
        sourceTracks.forEach((track, index) => {
          const targetTrack =
            targetKindTracks[lastTargetIndex - (bottomSelectedIndex - sourceIndices[index]!)]
          if (targetTrack) {
            sourceTrackAssignments.set(track.id, targetTrack.id)
          }
        })
      }
    }
  }

  if (sourceTrackAssignments.size === 0) {
    const contiguousAssignments = buildContiguousTrackAssignment({
      sourceTrackIds:
        sourceTracks.length > 0 ? sourceTracks.map((track) => track.id) : sourceTrackIds,
      targetTracks: targetKindTracks,
      zone,
    })
    contiguousAssignments.forEach((targetTrackId, sourceTrackId) => {
      sourceTrackAssignments.set(sourceTrackId, targetTrackId)
    })
  }

  const defaultTrackId = zone === 'video' ? targetKindTracks[0]?.id : targetKindTracks.at(-1)?.id
  if (!defaultTrackId) {
    return null
  }

  const trackAssignments = new Map<string, string>()
  for (const draggedItem of draggedItems) {
    trackAssignments.set(
      draggedItem.id,
      sourceTrackAssignments.get(draggedItem.initialTrackId) ?? defaultTrackId,
    )
  }

  return {
    tracks: workingTracks,
    trackAssignments,
  }
}

function ensureTrackIndex(params: EnsureTrackIndexParams): {
  tracks: TimelineTrack[]
  trackId: string
} {
  const { kind, index, preferredTrackHeight } = params
  let workingTracks = [...params.tracks]

  while (getKindTracks(workingTracks, kind).length <= index) {
    const createdTrack = createClassicTrack({
      tracks: workingTracks,
      kind,
      order: getNextSectionOrder(workingTracks, kind),
      height: preferredTrackHeight,
    })
    workingTracks = [...workingTracks, createdTrack]
  }

  return {
    tracks: workingTracks,
    trackId: getKindTracks(workingTracks, kind)[index]!.id,
  }
}

function ensureTrackNumber(params: {
  tracks: TimelineTrack[]
  kind: TrackKind
  number: number
  preferredTrackHeight: number
}): { tracks: TimelineTrack[]; trackId: string } {
  let workingTracks = [...params.tracks]

  while (
    !getKindTracks(workingTracks, params.kind).some(
      (track) => getClassicTrackNumber(track, params.kind) === params.number,
    )
  ) {
    const createdTrack = createClassicTrack({
      tracks: workingTracks,
      kind: params.kind,
      order: getNextSectionOrder(workingTracks, params.kind),
      height: params.preferredTrackHeight,
    })
    workingTracks = [...workingTracks, createdTrack]
  }

  const resolvedTrack = getKindTracks(workingTracks, params.kind).find(
    (track) => getClassicTrackNumber(track, params.kind) === params.number,
  )

  return {
    tracks: workingTracks,
    trackId: resolvedTrack!.id,
  }
}

export function resolveLinkedDragTrackTargets(params: {
  tracks: TimelineTrack[]
  hoveredTrackId: string
  zone: LinkedDragDropZone
  createNew?: boolean
  preferredTrackHeight: number
}): LinkedDragTrackTargetResult | null {
  const { tracks, hoveredTrackId, zone, createNew = false, preferredTrackHeight } = params
  const hoveredTrack = tracks.find((track) => track.id === hoveredTrackId)
  if (!hoveredTrack) {
    return null
  }

  if (createNew) {
    const newVideoTrack = createClassicTrack({
      tracks,
      kind: 'video',
      order: getCreateNewTrackOrder(tracks, 'video'),
      height: preferredTrackHeight,
    })
    const tracksWithVideo = [...tracks, newVideoTrack]
    const newAudioTrack = createClassicTrack({
      tracks: tracksWithVideo,
      kind: 'audio',
      order: getCreateNewTrackOrder(tracksWithVideo, 'audio'),
      height: preferredTrackHeight,
    })

    return {
      tracks: [...tracksWithVideo, newAudioTrack],
      videoTrackId: newVideoTrack.id,
      audioTrackId: newAudioTrack.id,
    }
  }

  const zoneKind: TrackKind = zone === 'video' ? 'video' : 'audio'
  const companionKind: TrackKind = zone === 'video' ? 'audio' : 'video'
  const hoveredKind = getTrackKind(hoveredTrack)
  let workingTracks = [...tracks]
  let zoneTrackId: string
  let sectionIndex: number
  const hoveredTrackNumber = hoveredKind ? getClassicTrackNumber(hoveredTrack, hoveredKind) : null

  if (!hoveredTrack.locked && (hoveredKind === zoneKind || hoveredKind === null)) {
    const upgradedTrack = renameTrackForKind(hoveredTrack, workingTracks, zoneKind)
    if (upgradedTrack !== hoveredTrack) {
      workingTracks = workingTracks.map((track) =>
        track.id === hoveredTrack.id ? upgradedTrack : track,
      )
    }
    zoneTrackId = hoveredTrack.id
    sectionIndex = getTrackNumberIndex(workingTracks, zoneKind, zoneTrackId)
  } else {
    const referenceKind = hoveredKind === companionKind ? companionKind : zoneKind
    const referenceTracks = getKindTracks(workingTracks, referenceKind)
    sectionIndex = Math.max(
      0,
      referenceTracks.findIndex((track) => track.id === hoveredTrack.id),
    )
    const ensuredZoneTrack =
      hoveredTrackNumber !== null
        ? ensureTrackNumber({
            tracks: workingTracks,
            kind: zoneKind,
            number: hoveredTrackNumber,
            preferredTrackHeight,
          })
        : ensureTrackIndex({
            tracks: workingTracks,
            kind: zoneKind,
            index: sectionIndex,
            preferredTrackHeight,
          })
    workingTracks = ensuredZoneTrack.tracks
    zoneTrackId = ensuredZoneTrack.trackId
    sectionIndex = getTrackNumberIndex(workingTracks, zoneKind, zoneTrackId)
  }

  const zoneTrackNumber = getClassicTrackNumber(
    workingTracks.find((track) => track.id === zoneTrackId)!,
    zoneKind,
  )
  const ensuredCompanionTrack =
    zoneTrackNumber !== null
      ? ensureTrackNumber({
          tracks: workingTracks,
          kind: companionKind,
          number: zoneTrackNumber,
          preferredTrackHeight,
        })
      : ensureTrackIndex({
          tracks: workingTracks,
          kind: companionKind,
          index: sectionIndex,
          preferredTrackHeight,
        })
  workingTracks = ensuredCompanionTrack.tracks

  if (zone === 'video') {
    return {
      tracks: workingTracks,
      videoTrackId: zoneTrackId,
      audioTrackId: ensuredCompanionTrack.trackId,
    }
  }

  return {
    tracks: workingTracks,
    videoTrackId: ensuredCompanionTrack.trackId,
    audioTrackId: zoneTrackId,
  }
}
