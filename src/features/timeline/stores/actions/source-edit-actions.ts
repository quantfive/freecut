/**
 * Source Edit Actions - Insert and Overwrite editing from the source monitor.
 */

import type { TimelineTrack } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useEditorStore } from '@/shared/state/editor'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useProjectStore } from '@/features/timeline/deps/projects'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { getMediaType, resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { toast } from 'sonner'
import { execute, applyTransitionRepairs, getLogger } from './shared'
import {
  resolveSourceEditTrackTargets,
  type SourceEditTrackTargets,
} from '../../utils/source-edit-targeting'
import { buildMediaTimelineItems } from '../../utils/media-timeline-item-builder'
import { DEFAULT_TRACK_HEIGHT } from '../../constants'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { isTimelineTrackLocked, preflightTimelineMutation } from '../../utils/track-lock-invariants'

interface SourceEditContext {
  sourceMediaId: string
  videoTrackId?: string
  audioTrackId?: string
  effectiveIn: number
  effectiveOut: number
  clipDurationFrames: number
  insertFrame: number
  blobUrl: string
  thumbnailUrl: string | undefined
  media: {
    duration: number
    fps: number | undefined
    width: number | undefined
    height: number | undefined
    mimeType: string
    fileName: string
  }
  mediaType: 'video' | 'audio' | 'image' | 'lottie'
  hasAudio: boolean
  canvasWidth: number
  canvasHeight: number
  projectFps: number
  resolvedTracks: TimelineTrack[]
}

function getSourceMediaFingerprint(media: {
  duration: number
  fps?: number
  width?: number
  height?: number
  mimeType: string
  fileName: string
  audioCodec?: string
}): string {
  return JSON.stringify([
    media.duration,
    media.fps,
    media.width,
    media.height,
    media.mimeType,
    media.fileName,
    media.audioCodec,
  ])
}

function getUnchangedSourceMedia(sourceMediaId: string, mediaFingerprint: string) {
  const media = useMediaLibraryStore.getState().mediaById[sourceMediaId]
  if (!media) return null
  return getSourceMediaFingerprint(media) === mediaFingerprint ? media : null
}

function sourceMediaNeedsVideoPatch(mediaType: SourceEditContext['mediaType']): boolean {
  return mediaType === 'video' || mediaType === 'image' || mediaType === 'lottie'
}

function sourceMediaHasAudio(
  mediaType: SourceEditContext['mediaType'],
  audioCodec: string | undefined,
): boolean {
  return mediaType === 'video' ? Boolean(audioCodec) : false
}

function findTrackById(tracks: TimelineTrack[], trackId: string | null): TimelineTrack | null {
  if (!trackId) return null
  return tracks.find((track) => track.id === trackId) ?? null
}

function getSourceEditTrackInputs(params: {
  tracks: TimelineTrack[]
  activeTrackId: string | null
  preferredVideoTrackId: string | null
  preferredAudioTrackId: string | null
}) {
  const activeTrack = findTrackById(params.tracks, params.activeTrackId)
  const preferredVideoTrack = findTrackById(params.tracks, params.preferredVideoTrackId)
  const preferredAudioTrack = findTrackById(params.tracks, params.preferredAudioTrackId)
  return {
    activeTrack,
    referenceTrack: activeTrack ?? preferredVideoTrack ?? preferredAudioTrack,
  }
}

function getSourceEditTiming(params: {
  mediaType: SourceEditContext['mediaType']
  media: { duration: number; fps?: number }
  projectFps: number
  inPoint: number | null
  outPoint: number | null
}) {
  const sourceFps = params.media.fps || 30
  const sourceDurationFrames =
    params.mediaType === 'image'
      ? params.projectFps * 3
      : Math.max(1, Math.round(params.media.duration * sourceFps))
  const effectiveIn = params.inPoint ?? 0
  const effectiveOut = params.outPoint ?? sourceDurationFrames
  const sourceRangeFrames = effectiveOut - effectiveIn
  const clipDurationFrames =
    sourceFps === params.projectFps
      ? sourceRangeFrames
      : Math.max(1, Math.round((sourceRangeFrames * params.projectFps) / sourceFps))
  return { effectiveIn, effectiveOut, clipDurationFrames }
}

function warnSourceEditTargetFailure(params: {
  mediaType: SourceEditContext['mediaType']
  hasAudio: boolean
  patchVideo: boolean
  patchAudio: boolean
}): void {
  if (!params.patchVideo && !params.patchAudio) {
    toast.warning('Enable V and/or A source patch targets first')
    return
  }
  if (params.mediaType === 'audio' && !params.patchAudio) {
    toast.warning('Enable the A source patch target to edit audio')
    return
  }
  if (sourceMediaNeedsVideoPatch(params.mediaType) && !params.patchVideo && !params.hasAudio) {
    toast.warning('Enable the V source patch target to edit this source')
    return
  }
  toast.warning('Unable to resolve source patch targets')
}

function resolveCurrentSourceEditTargets(params: {
  tracks: TimelineTrack[]
  activeTrackId: string | null
  preferredVideoTrackId: string | null
  preferredAudioTrackId: string | null
  mediaType: SourceEditContext['mediaType']
  hasAudio: boolean
  patchVideo: boolean
  patchAudio: boolean
  preferredTrackHeight: number
}): SourceEditTrackTargets | null {
  const resolvedTargets = resolveSourceEditTrackTargets({
    tracks: params.tracks,
    activeTrackId: params.activeTrackId,
    preferredVideoTrackId: params.preferredVideoTrackId,
    preferredAudioTrackId: params.preferredAudioTrackId,
    mediaType: params.mediaType,
    hasAudio: params.hasAudio,
    patchVideo: params.patchVideo,
    patchAudio: params.patchAudio,
    preferredTrackHeight: params.preferredTrackHeight,
  })
  if (!resolvedTargets) {
    warnSourceEditTargetFailure(params)
    return null
  }

  const targetTrackIds = new Set(
    [resolvedTargets.videoTrackId, resolvedTargets.audioTrackId].filter(
      (trackId): trackId is string => !!trackId,
    ),
  )
  const lockedTarget = resolvedTargets.tracks.find(
    (track) =>
      targetTrackIds.has(track.id) && isTimelineTrackLocked(resolvedTargets.tracks, track.id),
  )
  if (!lockedTarget) return resolvedTargets
  toast.warning(`Target track ${lockedTarget.name} is locked`)
  return null
}

function buildCurrentSourceEditContext(params: {
  sourceMediaId: string
  mediaFingerprint: string
  blobUrl: string
  thumbnailUrl?: string
}): SourceEditContext | null {
  const { sourceMediaId, mediaFingerprint, blobUrl, thumbnailUrl } = params
  const editorState = useEditorStore.getState()
  if (editorState.sourcePreviewMediaId !== sourceMediaId) return null

  const media = getUnchangedSourceMedia(sourceMediaId, mediaFingerprint)
  if (!media) return null

  const mediaType = getMediaType(media.mimeType)
  if (mediaType === 'unknown') return null

  const {
    sourcePatchVideoEnabled,
    sourcePatchAudioEnabled,
    sourcePatchVideoTrackId,
    sourcePatchAudioTrackId,
  } = editorState
  const { inPoint, outPoint } = useSourcePlayerStore.getState()
  const { activeTrackId } = useSelectionStore.getState()
  const tracks = useItemsStore.getState().tracks
  const projectFps = useTimelineSettingsStore.getState().fps
  const { referenceTrack } = getSourceEditTrackInputs({
    tracks,
    activeTrackId,
    preferredVideoTrackId: sourcePatchVideoTrackId,
    preferredAudioTrackId: sourcePatchAudioTrackId,
  })
  const timing = getSourceEditTiming({ mediaType, media, projectFps, inPoint, outPoint })
  const currentProject = useProjectStore.getState().currentProject
  const hasAudio = sourceMediaHasAudio(mediaType, media.audioCodec)
  const resolvedTargets = resolveCurrentSourceEditTargets({
    tracks,
    activeTrackId,
    preferredVideoTrackId: sourcePatchVideoTrackId,
    preferredAudioTrackId: sourcePatchAudioTrackId,
    mediaType,
    hasAudio,
    patchVideo: sourcePatchVideoEnabled,
    patchAudio: sourcePatchAudioEnabled,
    preferredTrackHeight: referenceTrack?.height ?? DEFAULT_TRACK_HEIGHT,
  })
  if (!resolvedTargets) return null

  return {
    sourceMediaId,
    videoTrackId: resolvedTargets.videoTrackId,
    audioTrackId: resolvedTargets.audioTrackId,
    effectiveIn: timing.effectiveIn,
    effectiveOut: timing.effectiveOut,
    clipDurationFrames: timing.clipDurationFrames,
    insertFrame: usePlaybackStore.getState().currentFrame,
    blobUrl,
    thumbnailUrl,
    media: {
      duration: media.duration,
      fps: media.fps,
      width: media.width,
      height: media.height,
      mimeType: media.mimeType,
      fileName: media.fileName,
    },
    mediaType,
    hasAudio,
    canvasWidth: currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
    canvasHeight: currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
    projectFps,
    resolvedTracks: resolvedTargets.tracks,
  }
}

function getTrackAncestryFingerprint(tracks: TimelineTrack[], trackId: string): string | null {
  if (!tracks.some((track) => track.id === trackId)) return null

  const trackById = new Map(tracks.map((track) => [track.id, track] as const))
  const visited = new Set<string>()
  const ancestry: Array<
    Pick<TimelineTrack, 'id' | 'parentTrackId' | 'kind' | 'isGroup' | 'locked' | 'order' | 'height'>
  > = []
  let currentId: string | undefined = trackId

  while (currentId) {
    if (visited.has(currentId)) {
      ancestry.push({
        id: `cycle:${currentId}`,
        locked: true,
        order: 0,
        height: 0,
      })
      break
    }
    visited.add(currentId)

    const track = trackById.get(currentId)
    if (!track) {
      ancestry.push({
        id: `missing:${currentId}`,
        locked: true,
        order: 0,
        height: 0,
      })
      break
    }

    ancestry.push({
      id: track.id,
      parentTrackId: track.parentTrackId,
      kind: track.kind,
      isGroup: track.isGroup,
      locked: track.locked,
      order: track.order,
      height: track.height,
    })
    currentId = track.parentTrackId
  }

  return JSON.stringify(ancestry)
}

interface ExistingSourceTargetBaseline {
  video?: { id: string; ancestryFingerprint: string }
  audio?: { id: string; ancestryFingerprint: string }
}

function captureExistingTargetBaseline(
  context: SourceEditContext,
  tracks: TimelineTrack[],
): ExistingSourceTargetBaseline {
  const capture = (trackId: string | undefined) => {
    if (!trackId) return undefined
    const ancestryFingerprint = getTrackAncestryFingerprint(tracks, trackId)
    return ancestryFingerprint ? { id: trackId, ancestryFingerprint } : undefined
  }

  return {
    video: capture(context.videoTrackId),
    audio: capture(context.audioTrackId),
  }
}

function sourceTargetsDrifted(
  baseline: ExistingSourceTargetBaseline,
  context: SourceEditContext,
  currentTracks: TimelineTrack[],
): boolean {
  return (
    (!!baseline.video &&
      (context.videoTrackId !== baseline.video.id ||
        getTrackAncestryFingerprint(currentTracks, baseline.video.id) !==
          baseline.video.ancestryFingerprint)) ||
    (!!baseline.audio &&
      (context.audioTrackId !== baseline.audio.id ||
        getTrackAncestryFingerprint(currentTracks, baseline.audio.id) !==
          baseline.audio.ancestryFingerprint))
  )
}

async function resolveSourceEditContext(): Promise<SourceEditContext | null> {
  const sourceMediaId = useEditorStore.getState().sourcePreviewMediaId
  if (!sourceMediaId) {
    toast.warning('Open a source in the source monitor first')
    return null
  }

  const initialMedia = useMediaLibraryStore.getState().mediaById[sourceMediaId]
  if (!initialMedia) {
    getLogger().warn('Source edit: Source media not found')
    return null
  }
  if (getMediaType(initialMedia.mimeType) === 'unknown') {
    getLogger().warn('Source edit: Unknown media type')
    return null
  }

  const mediaFingerprint = getSourceMediaFingerprint(initialMedia)
  const initialTracks = useItemsStore.getState().tracks
  const initialContext = buildCurrentSourceEditContext({
    sourceMediaId,
    mediaFingerprint,
    blobUrl: '',
  })
  if (!initialContext) return null
  const targetBaseline = captureExistingTargetBaseline(initialContext, initialTracks)

  // Resolve every async asset first. The complete edit plan is deliberately
  // rebuilt from live stores only after these awaits, so concurrent timeline
  // changes cannot be overwritten by an earlier tracks/items snapshot.
  const blobUrl = await resolveMediaUrl(sourceMediaId)
  if (!blobUrl) {
    toast.error('Failed to load source media')
    return null
  }
  const { mediaLibraryService } = await importMediaLibraryService()
  const thumbnailUrl = (await mediaLibraryService.getThumbnailBlobUrl(sourceMediaId)) || undefined

  const context = buildCurrentSourceEditContext({
    sourceMediaId,
    mediaFingerprint,
    blobUrl,
    thumbnailUrl,
  })
  if (!context) return null

  const currentTracks = useItemsStore.getState().tracks
  if (sourceTargetsDrifted(targetBaseline, context, currentTracks)) return null

  return context
}

function createTimelineItems(ctx: SourceEditContext) {
  if (ctx.mediaType === 'audio' && !ctx.audioTrackId) {
    return []
  }
  if (
    (ctx.mediaType === 'video' || ctx.mediaType === 'image' || ctx.mediaType === 'lottie') &&
    !ctx.videoTrackId
  ) {
    return []
  }

  return buildMediaTimelineItems({
    media: {
      duration: ctx.media.duration,
      width: ctx.media.width,
      height: ctx.media.height,
      fps: ctx.media.fps,
    },
    mediaId: ctx.sourceMediaId,
    mediaType: ctx.mediaType,
    label: ctx.media.fileName,
    projectFps: ctx.projectFps,
    blobUrl: ctx.blobUrl,
    thumbnailUrl: ctx.thumbnailUrl,
    canvasWidth: ctx.canvasWidth,
    canvasHeight: ctx.canvasHeight,
    sourceStart: ctx.effectiveIn,
    sourceEnd: ctx.effectiveOut,
    fallbackSourceFps: 30,
    placements: {
      primary: {
        trackId: ctx.mediaType === 'audio' ? ctx.audioTrackId! : ctx.videoTrackId!,
        from: ctx.insertFrame,
        durationInFrames: ctx.clipDurationFrames,
      },
      linkedAudio:
        ctx.mediaType === 'video' && ctx.audioTrackId
          ? {
              trackId: ctx.audioTrackId,
              from: ctx.insertFrame,
              durationInFrames: ctx.clipDurationFrames,
            }
          : undefined,
    },
    linkVideoAudio: ctx.mediaType === 'video' && !!ctx.audioTrackId,
    createLinkedGroupId: ctx.mediaType === 'video' && ctx.hasAudio,
  })
}

function canCommitSourceEdit(params: {
  mode: 'insert' | 'overwrite'
  targetTrackIds: string[]
  resolvedTracks: TimelineTrack[]
  start: number
  end: number
}): boolean {
  const { items } = useItemsStore.getState()
  const targetTrackIdSet = new Set(params.targetTrackIds)
  const mutationIds = items
    .filter((item) => {
      if (!targetTrackIdSet.has(item.trackId)) return false
      const itemEnd = item.from + item.durationInFrames
      return params.mode === 'insert'
        ? (item.from < params.start && itemEnd > params.start) || item.from >= params.start
        : item.from < params.end && itemEnd > params.start
    })
    .map((item) => item.id)
  return preflightTimelineMutation({
    items,
    tracks: params.resolvedTracks,
    itemIds: mutationIds,
    destinationTrackIds: params.targetTrackIds,
  }).allowed
}

export async function performInsertEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext()
  if (!ctx) return

  const { insertFrame, clipDurationFrames } = ctx
  const newItems = createTimelineItems(ctx)
  const targetTrackIds = Array.from(new Set(newItems.map((item) => item.trackId)))
  if (newItems.length === 0 || targetTrackIds.length === 0) {
    toast.warning('Unable to resolve source patch targets')
    return
  }
  if (
    !canCommitSourceEdit({
      mode: 'insert',
      targetTrackIds,
      resolvedTracks: ctx.resolvedTracks,
      start: insertFrame,
      end: insertFrame,
    })
  ) {
    return
  }

  execute(
    'INSERT_EDIT',
    () => {
      const store = useItemsStore.getState()
      store.setTracks(ctx.resolvedTracks)
      const splitIds: string[] = []
      const shiftedIds: string[] = []

      for (const targetTrackId of targetTrackIds) {
        const straddleItem = useItemsStore
          .getState()
          .items.find(
            (item) =>
              item.trackId === targetTrackId &&
              item.from < insertFrame &&
              item.from + item.durationInFrames > insertFrame,
          )

        if (straddleItem) {
          const splitResult = store._splitItem(straddleItem.id, insertFrame)
          if (splitResult) {
            splitIds.push(splitResult.leftItem.id, splitResult.rightItem.id)
          }
        }

        const itemsToShift = useItemsStore
          .getState()
          .items.filter((item) => item.trackId === targetTrackId && item.from >= insertFrame)
        for (const item of itemsToShift) {
          store._moveItem(item.id, item.from + clipDurationFrames)
          shiftedIds.push(item.id)
        }
      }

      for (const newItem of newItems) {
        store._addItem(newItem)
      }

      const affectedIds = [...newItems.map((item) => item.id), ...shiftedIds, ...splitIds]
      applyTransitionRepairs(affectedIds)

      useTimelineSettingsStore.getState().markDirty()
    },
    { trackIds: targetTrackIds, insertFrame, clipDurationFrames },
  )

  // Advance playhead to end of inserted clip
  usePlaybackStore.getState().setCurrentFrame(insertFrame + clipDurationFrames)
  toast.success('Insert edit applied')
}

export async function performOverwriteEdit(): Promise<void> {
  const ctx = await resolveSourceEditContext()
  if (!ctx) return

  const { insertFrame, clipDurationFrames } = ctx
  const overwriteStart = insertFrame
  const overwriteEnd = insertFrame + clipDurationFrames
  const newItems = createTimelineItems(ctx)
  const targetTrackIds = Array.from(new Set(newItems.map((item) => item.trackId)))
  if (newItems.length === 0 || targetTrackIds.length === 0) {
    toast.warning('Unable to resolve source patch targets')
    return
  }
  if (
    !canCommitSourceEdit({
      mode: 'overwrite',
      targetTrackIds,
      resolvedTracks: ctx.resolvedTracks,
      start: overwriteStart,
      end: overwriteEnd,
    })
  ) {
    return
  }

  execute(
    'OVERWRITE_EDIT',
    () => {
      const store = useItemsStore.getState()
      store.setTracks(ctx.resolvedTracks)
      const affectedIds: string[] = []

      for (const targetTrackId of targetTrackIds) {
        const overlapping = useItemsStore
          .getState()
          .items.filter(
            (item) =>
              item.trackId === targetTrackId &&
              item.from < overwriteEnd &&
              item.from + item.durationInFrames > overwriteStart,
          )

        for (const item of overlapping) {
          const itemEnd = item.from + item.durationInFrames
          const startsBeforeRegion = item.from < overwriteStart
          const endsAfterRegion = itemEnd > overwriteEnd

          if (!startsBeforeRegion && !endsAfterRegion) {
            store._removeItems([item.id])
          } else if (startsBeforeRegion && endsAfterRegion) {
            const splitResult = store._splitItem(item.id, overwriteStart)
            if (splitResult) {
              affectedIds.push(splitResult.leftItem.id)
              const splitResult2 = useItemsStore
                .getState()
                ._splitItem(splitResult.rightItem.id, overwriteEnd)
              if (splitResult2) {
                store._removeItems([splitResult2.leftItem.id])
                affectedIds.push(splitResult2.rightItem.id)
              }
            }
          } else if (startsBeforeRegion) {
            const splitResult = store._splitItem(item.id, overwriteStart)
            if (splitResult) {
              store._removeItems([splitResult.rightItem.id])
              affectedIds.push(splitResult.leftItem.id)
            }
          } else {
            const splitResult = store._splitItem(item.id, overwriteEnd)
            if (splitResult) {
              store._removeItems([splitResult.leftItem.id])
              affectedIds.push(splitResult.rightItem.id)
            }
          }
        }
      }

      for (const newItem of newItems) {
        store._addItem(newItem)
        affectedIds.push(newItem.id)
      }

      applyTransitionRepairs(affectedIds)
      useTimelineSettingsStore.getState().markDirty()
    },
    { trackIds: targetTrackIds, overwriteStart, overwriteEnd },
  )

  // Advance playhead to end of overwritten clip
  usePlaybackStore.getState().setCurrentFrame(overwriteEnd)
  toast.success('Overwrite edit applied')
}
