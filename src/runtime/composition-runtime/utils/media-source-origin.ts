/**
 * Whether a media element source survives routing through
 * MediaElementAudioSourceNode.  Per the HTML spec, a media element whose
 * resource is cross-origin and not CORS-approved outputs zeroes through the
 * Web Audio graph, so cross-origin preview sources (e.g. host-provided
 * signed URLs that lack Access-Control-Allow-Origin) must drive
 * element.volume/muted directly instead.  blob: and data: URLs inherit the
 * embedding origin and are always graph-safe.
 */
export function isWebAudioSafeMediaSource(src: string): boolean {
  if (!src) return true
  if (src.startsWith('blob:') || src.startsWith('data:')) return true
  if (typeof location === 'undefined') return true
  try {
    return new URL(src, location.href).origin === location.origin
  } catch {
    return true
  }
}
