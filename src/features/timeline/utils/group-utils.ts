import type { TimelineItem, TimelineTrack } from '@/types/timeline'

type EffectiveTrackState = Pick<TimelineTrack, 'locked' | 'muted' | 'visible' | 'solo'>

const ROOT_EFFECTIVE_TRACK_STATE: EffectiveTrackState = {
  locked: false,
  muted: false,
  visible: true,
  solo: false,
}
const INVALID_PARENT_EFFECTIVE_TRACK_STATE: EffectiveTrackState = {
  ...ROOT_EFFECTIVE_TRACK_STATE,
  // A malformed ancestry chain must not make an otherwise inherited lock
  // disappear. Other properties retain their canonical neutral defaults.
  locked: true,
}

function inheritTrackState(
  track: TimelineTrack,
  parentState: EffectiveTrackState,
): EffectiveTrackState {
  return {
    locked: track.locked || parentState.locked,
    muted: track.muted || parentState.muted,
    visible: track.visible !== false && parentState.visible,
    solo: track.solo || parentState.solo,
  }
}

interface GroupAncestryTrace {
  path: TimelineTrack[]
  parentState: EffectiveTrackState
  cycleStartIndex: number | null
}

function traceGroupAncestry(
  groupId: string,
  groupsById: ReadonlyMap<string, TimelineTrack>,
  effectiveGroupStateById: ReadonlyMap<string, EffectiveTrackState>,
): GroupAncestryTrace {
  const path: TimelineTrack[] = []
  const pathIndexById = new Map<string, number>()
  let currentId = groupId

  while (true) {
    const knownState = effectiveGroupStateById.get(currentId)
    if (knownState) return { path, parentState: knownState, cycleStartIndex: null }

    const cycleStartIndex = pathIndexById.get(currentId)
    if (cycleStartIndex !== undefined) {
      return {
        path,
        parentState: INVALID_PARENT_EFFECTIVE_TRACK_STATE,
        cycleStartIndex,
      }
    }

    const currentGroup = groupsById.get(currentId)
    if (!currentGroup) {
      return {
        path,
        parentState: INVALID_PARENT_EFFECTIVE_TRACK_STATE,
        cycleStartIndex: null,
      }
    }

    pathIndexById.set(currentId, path.length)
    path.push(currentGroup)
    if (!currentGroup.parentTrackId) {
      return { path, parentState: ROOT_EFFECTIVE_TRACK_STATE, cycleStartIndex: null }
    }
    currentId = currentGroup.parentTrackId
  }
}

function foldTrackStates(
  tracks: readonly TimelineTrack[],
  parentState: EffectiveTrackState,
): EffectiveTrackState {
  return tracks.reduceRight(
    (effectiveState, track) => inheritTrackState(track, effectiveState),
    parentState,
  )
}

/**
 * Build a set of track IDs whose items should contribute snap targets.
 */
export function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  return new Set(
    resolveEffectiveTrackStates(tracks)
      .filter((track) => track.visible !== false)
      .map((track) => track.id),
  )
}

/**
 * Remove layer-group containers that no longer own any child tracks.
 *
 * A layer group is an organizational timeline container, not an item lane of
 * its own, so retaining an empty container only leaves an orphaned UI row.
 */
export function pruneEmptyLayerGroups(tracks: TimelineTrack[]): TimelineTrack[] {
  const populatedGroupIds = new Set(
    tracks
      .filter((track) => !track.isGroup && track.parentTrackId)
      .map((track) => track.parentTrackId as string),
  )

  const nextTracks = tracks.filter((track) => !track.isGroup || populatedGroupIds.has(track.id))
  return nextTracks.length === tracks.length ? tracks : nextTracks
}

/**
 * Remove empty child lanes after deleting Motion layers, then remove any Layer
 * Group containers that no longer have children. Empty top-level classic
 * timeline tracks remain valid and are deliberately preserved.
 */
export function pruneEmptyLayerGroupHierarchy(
  tracks: TimelineTrack[],
  items: ReadonlyArray<Pick<TimelineItem, 'trackId'>>,
): TimelineTrack[] {
  const populatedTrackIds = new Set(items.map((item) => item.trackId))
  const tracksWithPopulatedGroupChildren = tracks.filter(
    (track) => track.isGroup || !track.parentTrackId || populatedTrackIds.has(track.id),
  )

  return pruneEmptyLayerGroups(tracksWithPopulatedGroupChildren)
}

/**
 * Return active timeline lanes with inherited Layer Group state and without
 * the organizational container rows themselves.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const groupsById = new Map(
    tracks.filter((track) => track.isGroup).map((track) => [track.id, track] as const),
  )
  const effectiveGroupStateById = new Map<string, EffectiveTrackState>()

  const resolveGroupState = (groupId: string): EffectiveTrackState => {
    const memoizedState = effectiveGroupStateById.get(groupId)
    if (memoizedState) return memoizedState

    const trace = traceGroupAncestry(groupId, groupsById, effectiveGroupStateById)
    let pathEndIndex = trace.path.length
    let parentState = trace.parentState

    if (trace.cycleStartIndex !== null) {
      const cycleGroups = trace.path.slice(trace.cycleStartIndex)
      parentState = foldTrackStates(cycleGroups, INVALID_PARENT_EFFECTIVE_TRACK_STATE)
      for (const cycleGroup of cycleGroups) {
        effectiveGroupStateById.set(cycleGroup.id, parentState)
      }
      pathEndIndex = trace.cycleStartIndex
    }

    for (let index = pathEndIndex - 1; index >= 0; index -= 1) {
      const group = trace.path[index]!
      parentState = inheritTrackState(group, parentState)
      effectiveGroupStateById.set(group.id, parentState)
    }

    return effectiveGroupStateById.get(groupId) ?? INVALID_PARENT_EFFECTIVE_TRACK_STATE
  }

  for (const groupId of groupsById.keys()) {
    resolveGroupState(groupId)
  }

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => {
      if (!track.parentTrackId) {
        return track
      }

      const parentState = groupsById.has(track.parentTrackId)
        ? resolveGroupState(track.parentTrackId)
        : INVALID_PARENT_EFFECTIVE_TRACK_STATE

      return {
        ...track,
        ...inheritTrackState(track, parentState),
      }
    })
}
