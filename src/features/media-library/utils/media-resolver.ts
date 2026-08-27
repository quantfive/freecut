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
const pendingRequests = new Map<string, Promise<string>>()

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

  // Check if there's already a pending request for this media
  if (pendingRequests.has(mediaId)) {
    return pendingRequests.get(mediaId)!
  }

  // Create the request promise
  const requestPromise = (async () => {
    const { mediaLibraryService, FileAccessError } =
      await import('@/features/media-library/services/media-library-service')

    try {
      // Get media metadata from library
      const media = await mediaLibraryService.getMedia(mediaId)

      if (!media) {
        logger.warn(`Media not found: ${mediaId}`)
        return '' // Fallback: empty string (Composition will skip)
      }

      // Get the source blob without an extra validation pass; getMediaFile
      // surfaces permission/missing-file errors with the same relink UI.
      const blob = await mediaLibraryService.getMediaFile(media)

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

      // Acquire blob URL through centralized manager (handles caching + ref counting)
      const blobUrl = blobUrlManager.acquire(mediaId, blob, {
        mediaId,
        storageType: media.storageType,
        fileHandle: media.storageType === 'handle' ? media.fileHandle : undefined,
        opfsPath: media.storageType === 'opfs' ? media.opfsPath : undefined,
        fileSize: media.fileSize,
      })

      // Register keyframe index for adaptive seek backtracking
      if (media.keyframeTimestamps && media.keyframeTimestamps.length > 0) {
        registerKeyframeIndex(blobUrl, media.keyframeTimestamps)
      }

      // Resolved successfully — clear any stale broken flag (e.g. the repair
      // sweep just restored the workspace copy) so the clip stops showing the
      // offline state without needing a reload.
      useMediaLibraryStore.getState().markMediaHealthy(mediaId)

      return blobUrl
    } catch (error) {
      logger.error(`Failed to resolve media ${mediaId}:`, error)

      // Mark media as broken if it's a file access error
      if (error instanceof FileAccessError) {
        const media = await mediaLibraryService.getMedia(mediaId)
        useMediaLibraryStore.getState().markMediaBroken(mediaId, {
          mediaId,
          fileName: media?.fileName ?? 'Unknown file',
          errorType: error.type === 'permission_denied' ? 'permission_denied' : 'file_missing',
        })
      }

      return '' // Fallback: empty string
    } finally {
      // Clean up pending request
      pendingRequests.delete(mediaId)
    }
  })()

  // Store the pending request
  pendingRequests.set(mediaId, requestPromise)

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
