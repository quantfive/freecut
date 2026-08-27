import type { TimelineItem, TimelineTrack } from '@/types/timeline'

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
  trackById: Map<string, TimelineTrack>
  duplicateTrackIds: Set<string>
  stateById: Map<string, EffectiveTrackState>
}): { path: TimelineTrack[]; inheritedState: EffectiveTrackState } {
  const path: TimelineTrack[] = []
  const pathIds = new Set<string>()
  let cursor: TimelineTrack | undefined = params.track

  while (cursor) {
    const cached = params.stateById.get(cursor.id)
    if (cached) return { path, inheritedState: cached }
    if (params.duplicateTrackIds.has(cursor.id)) {
      return { path, inheritedState: MALFORMED_TRACK_STATE }
    }
    if (pathIds.has(cursor.id)) return { path, inheritedState: MALFORMED_TRACK_STATE }

    pathIds.add(cursor.id)
    path.push(cursor)
    if (!cursor.parentTrackId) return { path, inheritedState: ROOT_TRACK_STATE }

    cursor = params.trackById.get(cursor.parentTrackId)
    if (!cursor) return { path, inheritedState: MALFORMED_TRACK_STATE }
  }

  return { path, inheritedState: MALFORMED_TRACK_STATE }
}

function resolveTrackState(params: {
  track: TimelineTrack
  trackById: Map<string, TimelineTrack>
  duplicateTrackIds: Set<string>
  stateById: Map<string, EffectiveTrackState>
}): EffectiveTrackState {
  const cached = params.stateById.get(params.track.id)
  if (cached) return cached
  if (params.duplicateTrackIds.has(params.track.id)) return MALFORMED_TRACK_STATE

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
 * would make it more audible/visible, not less.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  const trackById = new Map<string, TimelineTrack>()
  const duplicateTrackIds = new Set<string>()
  for (const track of tracks) {
    if (trackById.has(track.id)) {
      duplicateTrackIds.add(track.id)
    } else {
      trackById.set(track.id, track)
    }
  }
  const stateById = new Map<string, EffectiveTrackState>()

  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => {
      const state = resolveTrackState({ track, trackById, duplicateTrackIds, stateById })
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
