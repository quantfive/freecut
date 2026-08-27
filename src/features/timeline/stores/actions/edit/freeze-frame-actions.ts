import type { ImageItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { execute, applyTransitionRepairs, getLogger } from '../shared'
import { timelineToSourceFrames } from '../../../utils/source-calculations'
import { canMutateTimelineItems, isInTransitionOverlap } from './shared'
import { captureSnapshot, restoreSnapshot } from '../../commands/snapshot'

interface FreezeFramePlan {
  item: VideoItem
  fps: number
  media: { id: string; fps?: number }
  projectId: string
  downstreamItemIds: string[]
  fingerprint: string
}

function isFreezeFramePositionValid(item: VideoItem, playheadFrame: number): boolean {
  if (playheadFrame <= item.from || playheadFrame >= item.from + item.durationInFrames) return false
  return !isInTransitionOverlap(item.id, playheadFrame - item.from, item.durationInFrames)
}

function getFreezeFrameDownstreamItems(
  items: TimelineItem[],
  item: VideoItem,
  playheadFrame: number,
): TimelineItem[] {
  return items.filter(
    (candidate) =>
      candidate.id !== item.id &&
      candidate.trackId === item.trackId &&
      candidate.from >= playheadFrame,
  )
}

function getFreezeFrameParticipants(itemId: string, playheadFrame: number) {
  const store = useItemsStore.getState()
  const item = store.itemById[itemId]
  if (!item || item.type !== 'video') return null
  if (!isFreezeFramePositionValid(item, playheadFrame)) return null

  const downstreamItems = getFreezeFrameDownstreamItems(store.items, item, playheadFrame)
  const mutationIds = [itemId, ...downstreamItems.map((candidate) => candidate.id)]
  if (!canMutateTimelineItems(mutationIds, [item.trackId])) return null
  return { store, item, downstreamItems, mutationIds }
}

function getFreezeFrameScopeItems(items: TimelineItem[], mutationIds: string[]): TimelineItem[] {
  const mutationIdSet = new Set(mutationIds)
  const linkedGroupIds = new Set(
    items
      .filter((candidate) => mutationIdSet.has(candidate.id))
      .map((candidate) => candidate.linkedGroupId)
      .filter((groupId): groupId is string => !!groupId),
  )
  return items
    .filter(
      (candidate) =>
        mutationIdSet.has(candidate.id) ||
        (!!candidate.linkedGroupId && linkedGroupIds.has(candidate.linkedGroupId)),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

function getRelevantTrackStates(tracks: TimelineTrack[], trackIds: Set<string>) {
  const trackById = new Map(tracks.map((track) => [track.id, track] as const))
  const relevantTrackIds = new Set<string>()

  for (const trackId of trackIds) {
    const visited = new Set<string>()
    let currentId: string | undefined = trackId
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      relevantTrackIds.add(currentId)
      currentId = trackById.get(currentId)?.parentTrackId
    }
    if (currentId) relevantTrackIds.add(`cycle:${currentId}`)
  }

  return [...relevantTrackIds].sort().map((trackId) => {
    const track = trackById.get(trackId)
    return track
      ? {
          id: track.id,
          parentTrackId: track.parentTrackId,
          kind: track.kind,
          isGroup: track.isGroup,
          locked: track.locked,
          order: track.order,
          height: track.height,
        }
      : { id: trackId, missing: true }
  })
}

function buildFreezeFramePlan(itemId: string, playheadFrame: number): FreezeFramePlan | null {
  const participants = getFreezeFrameParticipants(itemId, playheadFrame)
  if (!participants) return null
  const { store, item, downstreamItems, mutationIds } = participants

  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
  if (!media) return null
  const projectId = useMediaLibraryStore.getState().currentProjectId
  if (!projectId) return null

  const scopeItems = getFreezeFrameScopeItems(store.items, mutationIds)
  const scopeItemIds = new Set(scopeItems.map((candidate) => candidate.id))
  const relevantTransitions = useTransitionsStore
    .getState()
    .transitions.filter(
      (transition) =>
        scopeItemIds.has(transition.leftClipId) || scopeItemIds.has(transition.rightClipId),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
  const trackIds = new Set(scopeItems.map((candidate) => candidate.trackId))
  const fps = useTimelineSettingsStore.getState().fps

  return {
    item,
    fps,
    media: { id: media.id, fps: media.fps },
    projectId,
    downstreamItemIds: downstreamItems.map((candidate) => candidate.id).toSorted(),
    fingerprint: JSON.stringify({
      item,
      scopeItems,
      tracks: getRelevantTrackStates(store.tracks, trackIds),
      transitions: relevantTransitions,
      fps,
      media: { id: media.id, fps: media.fps },
      projectId,
    }),
  }
}

/**
 * Insert a freeze frame at the playhead position.
 *
 * Extracts the video frame at the current playhead, stores it as a media entry,
 * splits the video clip at the playhead, and inserts a still image between the halves.
 *
 * This is async because frame extraction requires mediabunny. The timeline
 * mutations are batched in a single command for undo/redo atomicity.
 */
export async function insertFreezeFrame(itemId: string, playheadFrame: number): Promise<boolean> {
  const initialPlan = buildFreezeFramePlan(itemId, playheadFrame)
  if (!initialPlan) return false

  const { item, fps } = initialPlan
  const speed = item.speed ?? 1
  const sourceStart = item.sourceStart ?? 0
  const sourceFps = item.sourceFps ?? fps

  // Calculate source frame at playhead in source-native FPS
  const timelineOffset = playheadFrame - item.from
  const sourceFrame = sourceStart + timelineToSourceFrames(timelineOffset, speed, fps, sourceFps)

  // Calculate timestamp in seconds for frame extraction
  const mediaFps = initialPlan.media.fps || 30
  const timestampSeconds = sourceFrame / mediaFps
  let persistedFrame:
    | {
        mediaLibraryService: Awaited<
          ReturnType<typeof importMediaLibraryService>
        >['mediaLibraryService']
        projectId: string
        mediaId: string
      }
    | undefined
  let keepPersistedFrame = false

  try {
    const { mediaLibraryService } = await importMediaLibraryService()

    // Step 1: Get the media file blob
    const blob = await mediaLibraryService.getMediaFile(initialPlan.media.id)
    if (!blob) {
      getLogger().error('[insertFreezeFrame] Could not access media file')
      return false
    }

    // Step 2: Extract frame using mediabunny at native resolution
    const { Input, BlobSource, CanvasSink, ALL_FORMATS } = await import('mediabunny')
    const input = new Input({
      source: new BlobSource(blob as File),
      formats: ALL_FORMATS,
    })
    let sink: InstanceType<typeof CanvasSink> | undefined
    let frameBlob: Blob
    let frameWidth: number
    let frameHeight: number
    try {
      const videoTrack = await input.getPrimaryVideoTrack()
      if (!videoTrack) {
        getLogger().error('[insertFreezeFrame] No video track found')
        return false
      }

      frameWidth = videoTrack.displayWidth
      frameHeight = videoTrack.displayHeight
      sink = new CanvasSink(videoTrack, {
        width: frameWidth,
        height: frameHeight,
        fit: 'fill',
      })

      const wrapped = await sink.getCanvas(timestampSeconds)
      if (!wrapped) {
        getLogger().error('[insertFreezeFrame] Failed to extract frame')
        return false
      }

      const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement
      if ('convertToBlob' in canvas) {
        frameBlob = await canvas.convertToBlob({ type: 'image/png' })
      } else {
        frameBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error('Failed to create blob'))),
            'image/png',
          )
        })
      }
    } finally {
      ;(sink as unknown as { dispose?: () => void } | undefined)?.dispose?.()
      input.dispose()
    }

    // Avoid persistence if extraction awaited across any relevant source,
    // lane, linked-cohort, transition, track ancestry, or lock drift.
    const prePersistPlan = buildFreezeFramePlan(itemId, playheadFrame)
    if (!prePersistPlan || prePersistPlan.fingerprint !== initialPlan.fingerprint) return false

    // Step 3: Persist the frame as a media item. Delegates to the shared
    // import path (mediaLibraryService -> persistGeneratedMediaAsset) which
    // handles OPFS write, thumbnail generation, metadata persist, project
    // association, and workspace mirroring — plus rollback of all of those
    // if any step throws. Hand-rolling this here previously skipped the
    // rollback and had to be patched repeatedly (createMedia-before-thumbnailId,
    // store-prepend-before-execute).
    const fileName = `freeze-frame-${item.label || 'video'}-${Math.round(timestampSeconds * 100) / 100}s.png`
    const frameFile = new File([frameBlob], fileName, {
      type: 'image/png',
      lastModified: Date.now(),
    })

    const mediaMetadata = await mediaLibraryService.importGeneratedImage(
      frameFile,
      initialPlan.projectId,
      {
        width: frameWidth,
        height: frameHeight,
        tags: ['freeze-frame'],
        codec: 'png',
      },
    )
    const frameMediaId = mediaMetadata.id
    persistedFrame = {
      mediaLibraryService,
      projectId: initialPlan.projectId,
      mediaId: frameMediaId,
    }
    const frameBlobUrl = blobUrlManager.acquire(frameMediaId, frameBlob)

    // Rebuild the exact plan after the final await. Any relevant drift rejects
    // the operation; the finally block owns all persisted-media cleanup.
    const commitPlan = buildFreezeFramePlan(itemId, playheadFrame)
    if (!commitPlan || commitPlan.fingerprint !== initialPlan.fingerprint) return false

    // Step 4: Perform timeline mutations atomically (split + insert + shift).
    // Prepend the media item to the store only after execute() succeeds so a
    // failed _splitItem (e.g. the source clip was removed between validation
    // and execute) doesn't leave an orphaned entry in the media library UI.
    const freezeDurationFrames = Math.round(commitPlan.fps * 2) // 2 seconds
    const beforeSnapshot = captureSnapshot()
    const selectionBefore = useSelectionStore.getState()
    const dirtyBefore = useTimelineSettingsStore.getState().isDirty
    let success: boolean
    try {
      success = execute<boolean>(
        'INSERT_FREEZE_FRAME',
        (): boolean => {
          // Split the video at playhead
          const splitResult = useItemsStore.getState()._splitItem(itemId, playheadFrame)
          if (!splitResult) {
            getLogger().error('[insertFreezeFrame] Split failed')
            return false
          }

          const { leftItem, rightItem } = splitResult

          // Update transitions pointing to split item
          const transitions = useTransitionsStore.getState().transitions
          const updatedTransitions = transitions.map((transition) => {
            if (transition.leftClipId === itemId) {
              return { ...transition, leftClipId: rightItem.id }
            }
            return transition
          })
          useTransitionsStore.getState().setTransitions(updatedTransitions)

          // Create ImageItem for the freeze frame
          const freezeFrameItem: ImageItem = {
            id: crypto.randomUUID(),
            type: 'image',
            trackId: commitPlan.item.trackId,
            from: playheadFrame,
            durationInFrames: freezeDurationFrames,
            label: fileName,
            mediaId: frameMediaId,
            src: frameBlobUrl,
            sourceWidth: frameWidth,
            sourceHeight: frameHeight,
            transform: commitPlan.item.transform ? { ...commitPlan.item.transform } : undefined,
          }

          useItemsStore.getState()._addItem(freezeFrameItem)

          // Shift the right half forward by freeze frame duration
          const newRightFrom = rightItem.from + freezeDurationFrames
          useItemsStore.getState()._moveItem(rightItem.id, newRightFrom)

          // Shift only the exact downstream cohort that was fingerprinted and
          // lock-preflighted immediately before execute().
          for (const downstreamItemId of commitPlan.downstreamItemIds) {
            const downstreamItem = useItemsStore.getState().itemById[downstreamItemId]
            if (!downstreamItem) throw new Error('Freeze-frame downstream item drifted')
            useItemsStore
              .getState()
              ._moveItem(downstreamItem.id, downstreamItem.from + freezeDurationFrames)
          }

          // Repair transitions
          applyTransitionRepairs([leftItem.id, rightItem.id])

          // Select the freeze frame item
          useSelectionStore.getState().selectItems([freezeFrameItem.id])

          useTimelineSettingsStore.getState().markDirty()
          return true
        },
        { itemId, playheadFrame, freezeDurationFrames },
      )
    } catch (error) {
      restoreSnapshot(beforeSnapshot)
      useSelectionStore.setState({
        selectedItemIds: selectionBefore.selectedItemIds,
        selectedItemIdSet: new Set(selectionBefore.selectedItemIds),
        selectedMarkerId: selectionBefore.selectedMarkerId,
        selectedTransitionId: selectionBefore.selectedTransitionId,
        selectedTrackId: selectionBefore.selectedTrackId,
        selectedTrackIds: selectionBefore.selectedTrackIds,
        activeTrackId: selectionBefore.activeTrackId,
        selectionType: selectionBefore.selectionType,
        expandedKeyframeLanes: selectionBefore.expandedKeyframeLanes,
      })
      useTimelineSettingsStore.setState({ isDirty: dirtyBefore })
      throw error
    }

    if (!success) {
      return false
    }

    keepPersistedFrame = true
    try {
      useMediaLibraryStore.getState().prependMediaItem(mediaMetadata)
    } catch (error) {
      // Timeline and persistence already succeeded. Keep the referenced media
      // instead of deleting a successful output because a UI-store refresh
      // failed; the persisted entry will be rediscovered on the next reload.
      getLogger().warn('[insertFreezeFrame] Failed to prepend persisted media item', error)
    }
    return true
  } catch (error) {
    getLogger().error('[insertFreezeFrame] Failed:', error)
    return false
  } finally {
    if (persistedFrame && !keepPersistedFrame) {
      try {
        await persistedFrame.mediaLibraryService.deleteMediaFromProject(
          persistedFrame.projectId,
          persistedFrame.mediaId,
        )
      } catch (cleanupError) {
        getLogger().warn(
          '[insertFreezeFrame] Failed to roll back persisted frame after rejected commit',
          cleanupError,
        )
      } finally {
        try {
          blobUrlManager.release(persistedFrame.mediaId)
        } catch (cleanupError) {
          getLogger().warn(
            '[insertFreezeFrame] Failed to release persisted frame URL',
            cleanupError,
          )
        }
      }
    }
  }
}
