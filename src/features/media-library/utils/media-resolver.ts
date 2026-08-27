import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { proxyService } from '@/features/media-library/services/proxy-service'
import { getSharedProxyKey } from '@/features/media-library/utils/proxy-key'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { registerKeyframeIndex } from '@/shared/utils/keyframe-index-registry'
import type { TimelineTrack } from '@/types/timeline'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('MediaResolver')

/**
 * Pending requests to prevent concurrent OPFS access to the same file
 * This prevents multiple sync access handle creation for the same OPFS file
 */
interface PendingMediaRequest {
  epoch: string
  promise: Promise<string>
}

const pendingRequests = new Map<string, PendingMediaRequest>()

type MediaLibraryServiceModule =
  typeof import('@/features/media-library/services/media-library-service')
type MediaLibraryService = MediaLibraryServiceModule['mediaLibraryService']
type ResolvedMedia = NonNullable<Awaited<ReturnType<MediaLibraryService['getMedia']>>>

function isCurrentMediaEpoch(mediaId: string, epoch: string): boolean {
  return blobUrlManager.getEpoch(mediaId) === epoch
}

function acquireResolvedMediaUrl(mediaId: string, blob: Blob, media: ResolvedMedia): string {
  const blobUrl = blobUrlManager.acquire(mediaId, blob, {
    mediaId,
    storageType: media.storageType,
    fileHandle: media.storageType === 'handle' ? media.fileHandle : undefined,
    opfsPath: media.storageType === 'opfs' ? media.opfsPath : undefined,
    fileSize: media.fileSize,
  })

  if (media.keyframeTimestamps && media.keyframeTimestamps.length > 0) {
    registerKeyframeIndex(blobUrl, media.keyframeTimestamps)
  }
  return blobUrl
}

async function resolveCurrentMediaUrl(
  mediaId: string,
  requestEpoch: string,
  mediaLibraryService: MediaLibraryService,
): Promise<string> {
  const media = await mediaLibraryService.getMedia(mediaId)
  if (!isCurrentMediaEpoch(mediaId, requestEpoch)) return ''

  if (!media) {
    logger.warn(`Media not found: ${mediaId}`)
    return ''
  }

  // Get the source blob without an extra validation pass; getMediaFile
  // surfaces permission/missing-file errors with the same relink UI.
  const blob = await mediaLibraryService.getMediaFile(media)
  if (!isCurrentMediaEpoch(mediaId, requestEpoch)) return ''

  if (!blob) {
    // The media record exists but its bytes can't be resolved (no valid
    // storage path — e.g. opened on an origin whose OPFS lacks it and the
    // workspace folder has no copy). getMediaFile returns null WITHOUT a
    // FileAccessError, so surface it into the broken-media system here so
    // the clip shows a relink state and the missing-media dialog lights up.
    logger.warn(`Media blob not found: ${mediaId}`)
    useMediaLibraryStore.getState().markMediaBroken(mediaId, {
      mediaId,
      fileName: media.fileName ?? 'Unknown file',
      errorType: 'file_missing',
    })
    return ''
  }

  const blobUrl = acquireResolvedMediaUrl(mediaId, blob, media)
  useMediaLibraryStore.getState().markMediaHealthy(mediaId)
  return blobUrl
}

async function markMediaBrokenFromAccessError(
  mediaId: string,
  requestEpoch: string,
  error: unknown,
  mediaLibraryService: MediaLibraryService,
  FileAccessError: MediaLibraryServiceModule['FileAccessError'],
): Promise<void> {
  if (!(error instanceof FileAccessError)) return

  const media = await mediaLibraryService.getMedia(mediaId)
  if (!isCurrentMediaEpoch(mediaId, requestEpoch)) return
  useMediaLibraryStore.getState().markMediaBroken(mediaId, {
    mediaId,
    fileName: media?.fileName ?? 'Unknown file',
    errorType: error.type === 'permission_denied' ? 'permission_denied' : 'file_missing',
  })
}

async function loadMediaRequest(mediaId: string, requestEpoch: string): Promise<string> {
  const { mediaLibraryService, FileAccessError } =
    await import('@/features/media-library/services/media-library-service')
  if (!isCurrentMediaEpoch(mediaId, requestEpoch)) return ''

  try {
    return await resolveCurrentMediaUrl(mediaId, requestEpoch, mediaLibraryService)
  } catch (error) {
    if (!isCurrentMediaEpoch(mediaId, requestEpoch)) return ''
    logger.error(`Failed to resolve media ${mediaId}:`, error)
    await markMediaBrokenFromAccessError(
      mediaId,
      requestEpoch,
      error,
      mediaLibraryService,
      FileAccessError,
    )
    return ''
  }
}

type RuntimeMediaResolver = (mediaId: string) => Promise<string | null> | string | null

let runtimeMediaResolver: RuntimeMediaResolver | null = null

/**
 * Install a runtime-only media resolver for an embedded host.  The resolver
 * receives an opaque media id and returns a playback locator for this session;
 * it is never written into a timeline item or project record.
 */
export function installRuntimeMediaResolver(resolver: RuntimeMediaResolver): () => void {
  const previous = runtimeMediaResolver
  const resolvedMediaIds = new Set<string>()
  const installedResolver: RuntimeMediaResolver = async (mediaId) => {
    const source = await resolver(mediaId)
    if (source) resolvedMediaIds.add(mediaId)
    return source
  }
  runtimeMediaResolver = installedResolver
  return () => {
    if (runtimeMediaResolver === installedResolver) {
      for (const mediaId of resolvedMediaIds) {
        blobUrlManager.invalidate(mediaId)
      }
      resolvedMediaIds.clear()
      runtimeMediaResolver = previous
    }
  }
}

/**
 * Resolves a mediaId to a blob URL for use in Composition Player
 *
 * @param mediaId - The ID of the media in the media library
 * @returns Blob URL for the media, or empty string if not found
 */
export async function resolveMediaUrl(mediaId: string): Promise<string> {
  if (runtimeMediaResolver) {
    const source = await runtimeMediaResolver(mediaId)
    if (!source) return ''

    // The preview runtime uses this manager as a freshness signal. Registering
    // an external locator keeps that signal in memory only; unlike acquire(),
    // it never creates or persists a Blob URL.
    const cached = blobUrlManager.get(mediaId)
    if (cached !== source) {
      if (cached) blobUrlManager.invalidate(mediaId)
      blobUrlManager.registerUrl(mediaId, source)
    }
    return source
  }

  // Check centralized manager first - URLs persist until explicit release
  const cached = blobUrlManager.get(mediaId)
  if (cached) {
    return cached
  }

  const requestEpoch = blobUrlManager.getEpoch(mediaId)

  // Deduplicate only within the currently valid source generation. Relinking
  // can invalidate an ID while an old storage read is still pending; that old
  // promise must not block or populate the replacement generation.
  const pendingRequest = pendingRequests.get(mediaId)
  if (pendingRequest?.epoch === requestEpoch) {
    return pendingRequest.promise
  }

  // Create the request promise
  let requestPromise!: Promise<string>
  requestPromise = loadMediaRequest(mediaId, requestEpoch).finally(() => {
    // A later source generation may already own this mediaId's slot. Only
    // the exact request that installed an entry may remove it.
    if (pendingRequests.get(mediaId)?.promise === requestPromise) {
      pendingRequests.delete(mediaId)
    }
  })

  // Store the pending request
  pendingRequests.set(mediaId, { epoch: requestEpoch, promise: requestPromise })

  return requestPromise
}

/**
 * Resolves a proxy URL for a media item if available.
 * Returns null if no proxy exists (caller should fall back to full-res).
 */
export function resolveProxyUrl(mediaId: string): string | null {
  if (runtimeMediaResolver) return null

  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (media) {
    const proxyKey = getSharedProxyKey(media)
    // Safety net for legacy state restores where the mapping may be missing.
    if (proxyService.getProxyKey(mediaId) !== proxyKey) {
      proxyService.setProxyKey(mediaId, proxyKey)
    }
    return proxyService.getProxyBlobUrl(mediaId, proxyKey)
  }

  return proxyService.getProxyBlobUrl(mediaId)
}

/**
 * Resolves all media URLs in timeline tracks
 * Creates a deep clone of tracks with resolved blob URLs
 *
 * @param tracks - Timeline tracks with media items
 * @param options.useProxy - If true, prefer proxy URLs for video items (default: true)
 * @returns Tracks with resolved blob URLs in item.src
 */
export async function resolveMediaUrls(
  tracks: TimelineTrack[],
  options?: { useProxy?: boolean; signal?: AbortSignal },
): Promise<TimelineTrack[]> {
  const useProxy = options?.useProxy ?? true
  const signal = options?.signal

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Media resolution aborted', 'AbortError')
  }
  throwIfAborted()

  // Deep clone tracks to avoid mutating original
  const resolvedTracks: TimelineTrack[] = structuredClone(tracks)

  // Resolve all media URLs in parallel
  const resolutionPromises: Promise<void>[] = []

  for (const track of resolvedTracks) {
    for (const item of track.items) {
      // Only resolve media items with mediaId
      if (
        item.mediaId &&
        (item.type === 'video' ||
          item.type === 'audio' ||
          item.type === 'image' ||
          item.type === 'lottie')
      ) {
        const resolution = resolveMediaUrl(item.mediaId).then((blobUrl) => {
          throwIfAborted()
          // For video items in preview mode, prefer proxy URL if available
          if (useProxy && item.type === 'video') {
            const proxyUrl = resolveProxyUrl(item.mediaId!)
            item.src = proxyUrl || blobUrl
            item.audioSrc = blobUrl
          } else {
            item.src = blobUrl
            if (item.type === 'video') {
              item.audioSrc = blobUrl
            }
          }
        })
        if (signal) {
          resolutionPromises.push(
            new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                signal.removeEventListener('abort', onAbort)
                reject(new DOMException('Media resolution aborted', 'AbortError'))
              }
              signal.addEventListener('abort', onAbort, { once: true })
              resolution.then(
                () => {
                  signal.removeEventListener('abort', onAbort)
                  resolve()
                },
                (error) => {
                  signal.removeEventListener('abort', onAbort)
                  reject(error)
                },
              )
              if (signal.aborted) onAbort()
            }),
          )
        } else {
          resolutionPromises.push(resolution)
        }
      }
    }
  }

  // Wait for all resolutions to complete
  await Promise.all(resolutionPromises)

  // Check if aborted after resolution
  throwIfAborted()

  return resolvedTracks
}

/**
 * Cleans up all cached blob URLs
 * Call this on component unmount to prevent memory leaks
 */
export function cleanupBlobUrls(): void {
  blobUrlManager.releaseAll()
  pendingRequests.clear()
}
