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

interface TrackHierarchyIndex {
  tracksById: Map<string, TimelineTrack[]>
  trackById: Map<string, TimelineTrack>
  duplicateTrackIds: Set<string>
}

function indexTrackHierarchy(tracks: TimelineTrack[]): TrackHierarchyIndex {
  const tracksById = new Map<string, TimelineTrack[]>()
  const trackById = new Map<string, TimelineTrack>()
  const duplicateTrackIds = new Set<string>()

  for (const track of tracks) {
    const definitions = tracksById.get(track.id)
    if (definitions) {
      definitions.push(track)
      duplicateTrackIds.add(track.id)
    } else {
      tracksById.set(track.id, [track])
      trackById.set(track.id, track)
    }
  }

  return { tracksById, trackById, duplicateTrackIds }
}

function collectRetainedGroupRootIds(
  tracks: TimelineTrack[],
  hierarchy: TrackHierarchyIndex,
): Set<string> {
  const retainedGroupIds = new Set(hierarchy.duplicateTrackIds)
  for (const track of tracks) {
    if (!track.isGroup && track.parentTrackId) retainedGroupIds.add(track.parentTrackId)
  }
  return retainedGroupIds
}

function retainGroupParent(
  track: TimelineTrack,
  retainedGroupIds: Set<string>,
  pendingGroupIds: string[],
): void {
  const parentId = track.isGroup ? track.parentTrackId : undefined
  if (!parentId || retainedGroupIds.has(parentId)) return
  retainedGroupIds.add(parentId)
  pendingGroupIds.push(parentId)
}

function collectRetainedGroupIds(
  tracks: TimelineTrack[],
  hierarchy: TrackHierarchyIndex,
): Set<string> {
  const retainedGroupIds = collectRetainedGroupRootIds(tracks, hierarchy)
  const pendingGroupIds = [...retainedGroupIds]

  for (let index = 0; index < pendingGroupIds.length; index += 1) {
    const definitions = hierarchy.tracksById.get(pendingGroupIds[index]!) ?? []
    for (const track of definitions) {
      retainGroupParent(track, retainedGroupIds, pendingGroupIds)
    }
  }

  return retainedGroupIds
}

/**
 * Remove layer-group containers that no longer own a descendant lane.
 *
 * A layer group is an organizational timeline container, not an item lane of
 * its own, so retaining a branch with no lane only leaves orphaned UI rows.
 * Starting from every non-group lane makes the traversal independent of input
 * order and retains its complete group ancestry. Missing parents terminate a
 * branch, while visited IDs make self/multi-node cycles finite. Every duplicate
 * ID is also a root: group/group and mixed group/lane definitions, plus every
 * possible group ancestor, remain in place so normalization cannot sanitize an
 * ambiguous topology into unlocked authorization. Lane/lane duplicates already
 * survive because pruning never removes ordinary lanes.
 */
export function pruneEmptyLayerGroups(tracks: TimelineTrack[]): TimelineTrack[] {
  const retainedGroupIds = collectRetainedGroupIds(tracks, indexTrackHierarchy(tracks))
  const nextTracks = tracks.filter((track) => !track.isGroup || retainedGroupIds.has(track.id))
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
  const hierarchy = indexTrackHierarchy(tracks)
  const populatedTrackIds = new Set(items.map((item) => item.trackId))
  const tracksWithPopulatedGroupChildren = tracks.filter(
    (track) =>
      track.isGroup ||
      hierarchy.duplicateTrackIds.has(track.id) ||
      !track.parentTrackId ||
      populatedTrackIds.has(track.id),
  )

  return pruneEmptyLayerGroups(tracksWithPopulatedGroupChildren)
}

type EffectiveTrackState = Pick<TimelineTrack, 'locked' | 'muted' | 'visible' | 'solo'> & {
  valid: boolean
}

const ROOT_TRACK_STATE: EffectiveTrackState = {
  locked: false,
  muted: false,
  visible: true,
  solo: false,
  valid: true,
}

const MALFORMED_TRACK_STATE: EffectiveTrackState = {
  locked: true,
  muted: true,
  visible: false,
  solo: false,
  valid: false,
}

function inheritTrackState(
  track: TimelineTrack,
  inheritedState: EffectiveTrackState,
): EffectiveTrackState {
  if (!inheritedState.valid) return MALFORMED_TRACK_STATE
  return {
    locked: track.locked || inheritedState.locked,
    muted: track.muted || inheritedState.muted,
    visible: track.visible !== false && inheritedState.visible,
    solo: track.solo || inheritedState.solo,
    valid: true,
  }
}

function collectTrackResolutionPath(params: {
  track: TimelineTrack
  hierarchy: TrackHierarchyIndex
  stateById: Map<string, EffectiveTrackState>
}): { path: TimelineTrack[]; inheritedState: EffectiveTrackState } {
  const path: TimelineTrack[] = []
  const pathIds = new Set<string>()
  let cursor: TimelineTrack | undefined = params.track

  while (cursor) {
    const cached = params.stateById.get(cursor.id)
    if (cached) return { path, inheritedState: cached }
    if (params.hierarchy.duplicateTrackIds.has(cursor.id)) {
      return { path, inheritedState: MALFORMED_TRACK_STATE }
    }
    if (pathIds.has(cursor.id)) return { path, inheritedState: MALFORMED_TRACK_STATE }

    pathIds.add(cursor.id)
    path.push(cursor)
    if (!cursor.parentTrackId) return { path, inheritedState: ROOT_TRACK_STATE }

    const parent = params.hierarchy.trackById.get(cursor.parentTrackId)
    if (!parent?.isGroup) return { path, inheritedState: MALFORMED_TRACK_STATE }
    cursor = parent
  }

  return { path, inheritedState: MALFORMED_TRACK_STATE }
}

function resolveTrackState(params: {
  track: TimelineTrack
  hierarchy: TrackHierarchyIndex
  stateById: Map<string, EffectiveTrackState>
}): EffectiveTrackState {
  const cached = params.stateById.get(params.track.id)
  if (cached) return cached
  if (params.hierarchy.duplicateTrackIds.has(params.track.id)) return MALFORMED_TRACK_STATE

  const { path, inheritedState } = collectTrackResolutionPath(params)
  let state = inheritedState
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const pathTrack = path[index]!
    state = inheritTrackState(pathTrack, state)
    params.stateById.set(pathTrack.id, state)
  }
  return params.stateById.get(params.track.id) ?? MALFORMED_TRACK_STATE
}

/**
 * Return active timeline lanes with inherited state from their complete
 * Layer Group ancestry and without the organizational container rows.
 *
 * Lock, mute, and solo are enabled by any ancestor; visibility must remain
 * enabled at every level. Malformed ancestry (a missing parent or a cycle) is
 * resolved fail-closed so every consumer sees the lane as locked, muted, and
 * hidden rather than making a different partial guess. Solo is disabled for
 * malformed ancestry because promoting an invalid lane into the solo set
 * would make it more audible/visible, not less. Duplicate IDs of every shape,
 * missing parents, non-group parents, self-parenting, and longer cycles are all
 * malformed. Only a unique chain of Layer Group parents may authorize a lane.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const hierarchy = indexTrackHierarchy(tracks)
  const stateById = new Map<string, EffectiveTrackState>()

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => {
      const state = resolveTrackState({ track, hierarchy, stateById })
      if (
        state.locked === track.locked &&
        state.muted === track.muted &&
        state.visible === track.visible &&
        state.solo === track.solo
      ) {
        return track
      }

      return {
        ...track,
        locked: state.locked,
        muted: state.muted,
        visible: state.visible,
        solo: state.solo,
      }
    })
}
