const SOURCE_MONITOR_FRAME_CACHE_MAX = 90
const SOURCE_MONITOR_FRAME_CACHE_BYTE_BUDGET = 128 * 1024 * 1024
const SOURCE_MONITOR_FRAME_CACHE_BYTES_PER_PIXEL = 4

export function getSourceMonitorFrameCacheCapacity(width: number, height: number): number {
  const frameBytes =
    Math.max(1, Math.round(width)) *
    Math.max(1, Math.round(height)) *
    SOURCE_MONITOR_FRAME_CACHE_BYTES_PER_PIXEL
  return Math.max(
    1,
    Math.min(
      SOURCE_MONITOR_FRAME_CACHE_MAX,
      Math.floor(SOURCE_MONITOR_FRAME_CACHE_BYTE_BUDGET / frameBytes),
    ),
  )
}
