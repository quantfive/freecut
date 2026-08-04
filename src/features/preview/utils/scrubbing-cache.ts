/**
 * 3-Tier Scrubbing Cache
 *
 * Tier 1 (VRAM): GPUTexture cache for instant scrub — cache hits avoid CPU→GPU
 *   upload entirely, just blit from cached texture to output.
 * Tier 2 (RAM): Per-video last-frame cache — when seeking between clips, the
 *   last decoded frame shows instantly without waiting for mediabunny decode.
 * Tier 3 (RAM): Deep frame buffer with LRU eviction — stores composited frames
 *   as ImageBitmaps. On access, promotes to Tier 1 if GPU is available.
 *
 * When all tiers are warm, scrubbing doesn't decode at all.
 */

import {
  hasFrameInvalidation,
  isFrameInRanges,
  type FrameInvalidationRequest,
} from '@/shared/utils/frame-invalidation'

// ---------------------------------------------------------------------------
// Tier 1 — VRAM GPU Texture Cache
// ---------------------------------------------------------------------------

interface GpuCacheEntry {
  texture: GPUTexture
  view: GPUTextureView
  slotIndex: number
  arrayLayer: number
  blitBindGroup?: GPUBindGroup
}

interface GpuTextureCacheStats {
  capacity: number
  estimatedBytes: number
  allocations: number
  evictions: number
  uploads: number
  arrayBacked: boolean
}

const MAX_FIXED_GPU_CACHE_BYTES = 512 * 1024 * 1024

/** Eviction hint: prefer evicting frames in the opposite scrub direction */
interface EvictionHint {
  currentFrame: number
  direction: -1 | 0 | 1
}

function findNearestFrame(
  frames: Iterable<number>,
  targetFrame: number,
  maxDistanceFrames: number,
): number | undefined {
  const boundedDistance = Math.max(0, Math.floor(maxDistanceFrames))
  let nearestFrame: number | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const frame of frames) {
    const distance = Math.abs(frame - targetFrame)
    if (distance === 0 || distance > boundedDistance || distance >= nearestDistance) continue
    nearestFrame = frame
    nearestDistance = distance
  }

  return nearestFrame
}

class GpuTextureCache {
  private cache = new Map<number, GpuCacheEntry>()
  private slots: GpuCacheEntry[] = []
  private freeSlotIndices: number[] = []
  private readonly configuredMaxFrames: number
  private maxFrames: number
  private device: GPUDevice | null = null
  private storageTexture: GPUTexture | null = null
  private arrayBacked = false
  private texW = 0
  private texH = 0
  private hint: EvictionHint | null = null
  private allocationCount = 0
  private evictionCount = 0
  private uploadCount = 0

  constructor(maxFrames: number) {
    this.configuredMaxFrames = Math.max(1, maxFrames)
    this.maxFrames = this.configuredMaxFrames
  }

  setEvictionHint(hint: EvictionHint): void {
    this.hint = hint
  }

  setDevice(device: GPUDevice, width: number, height: number): void {
    if (this.device === device && this.texW === width && this.texH === height) return
    this.disposeStorage()
    this.device = device
    this.texW = width
    this.texH = height

    const deviceMemoryGb = (navigator as { deviceMemory?: number }).deviceMemory
    const vramBudgetBytes =
      deviceMemoryGb !== undefined
        ? Math.min(deviceMemoryGb * 0.125, 1) * 1_000_000_000
        : 500_000_000
    const fixedAllocationBudgetBytes = Math.min(vramBudgetBytes, MAX_FIXED_GPU_CACHE_BYTES)
    const bytesPerFrame = width * height * 4
    this.maxFrames = Math.max(
      1,
      Math.min(
        this.configuredMaxFrames,
        Math.floor(fixedAllocationBudgetBytes / bytesPerFrame),
        Number(
          (device as GPUDevice & { limits?: GPUSupportedLimits }).limits?.maxTextureArrayLayers,
        ) || this.configuredMaxFrames,
      ),
    )

    try {
      const texture = device.createTexture({
        label: 'scrub-cache-frame-array',
        size: { width, height, depthOrArrayLayers: this.maxFrames },
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.storageTexture = texture
      this.arrayBacked = true
      this.allocationCount++
      this.slots = Array.from({ length: this.maxFrames }, (_, arrayLayer) => ({
        texture,
        view: texture.createView({
          dimension: '2d',
          baseArrayLayer: arrayLayer,
          arrayLayerCount: 1,
        }),
        slotIndex: arrayLayer,
        arrayLayer,
      }))
      this.resetFreeSlots()
    } catch {
      // Keep a recycled per-slot fallback for adapters that reject one large
      // array allocation. It still reaches allocation stability after warmup.
      this.storageTexture = null
      this.arrayBacked = false
      this.slots = []
      this.freeSlotIndices = []
    }
  }

  get(frame: number): GpuCacheEntry | undefined {
    const entry = this.cache.get(frame)
    if (!entry) return undefined
    this.cache.delete(frame)
    this.cache.set(frame, entry)
    return entry
  }

  getNearest(
    frame: number,
    maxDistanceFrames: number,
  ): { frame: number; entry: GpuCacheEntry } | undefined {
    const nearestFrame = findNearestFrame(this.cache.keys(), frame, maxDistanceFrames)
    if (nearestFrame === undefined) return undefined
    const entry = this.get(nearestFrame)
    return entry ? { frame: nearestFrame, entry } : undefined
  }

  put(frame: number, source: ImageBitmap | OffscreenCanvas): GpuCacheEntry | null {
    if (!this.device || this.texW < 2 || this.texH < 2) return null
    const cached = this.cache.get(frame)
    if (cached) return cached

    const entry = this.takeVictimSlot() ?? this.acquireSlot()
    if (!entry) return null
    if (!this.uploadToSlot(entry, source)) {
      this.releaseSlot(entry)
      return null
    }
    this.cache.set(frame, entry)
    this.uploadCount++
    return entry
  }

  private takeVictimSlot(): GpuCacheEntry | undefined {
    if (this.cache.size < this.maxFrames) return undefined
    const victim = this.pickEvictionVictim()
    if (victim === undefined) return undefined
    const entry = this.cache.get(victim)
    this.cache.delete(victim)
    this.evictionCount++
    return entry
  }

  private uploadToSlot(entry: GpuCacheEntry, source: ImageBitmap | OffscreenCanvas): boolean {
    if (!this.device) return false
    try {
      this.device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        this.arrayBacked
          ? { texture: entry.texture, origin: { x: 0, y: 0, z: entry.arrayLayer } }
          : { texture: entry.texture },
        { width: this.texW, height: this.texH },
      )
      return true
    } catch {
      return false
    }
  }

  private acquireSlot(): GpuCacheEntry | undefined {
    const freeSlotIndex = this.freeSlotIndices.pop()
    if (freeSlotIndex !== undefined) return this.slots[freeSlotIndex]
    if (this.arrayBacked || !this.device || this.slots.length >= this.maxFrames) return undefined

    const texture = this.device.createTexture({
      label: 'scrub-cache-frame-slot',
      size: { width: this.texW, height: this.texH },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const entry: GpuCacheEntry = {
      texture,
      view: texture.createView(),
      slotIndex: this.slots.length,
      arrayLayer: 0,
    }
    this.slots.push(entry)
    this.allocationCount++
    return entry
  }

  private releaseSlot(entry: GpuCacheEntry): void {
    if (!this.freeSlotIndices.includes(entry.slotIndex)) {
      this.freeSlotIndices.push(entry.slotIndex)
    }
  }

  private resetFreeSlots(): void {
    this.freeSlotIndices = this.slots.map((entry) => entry.slotIndex).reverse()
  }

  private pickEvictionVictim(): number | undefined {
    if (!this.hint || this.hint.direction === 0) return this.cache.keys().next().value
    const { currentFrame, direction } = this.hint
    for (const frame of this.cache.keys()) {
      if (direction > 0 ? frame < currentFrame : frame > currentFrame) return frame
    }
    return this.cache.keys().next().value
  }

  has(frame: number): boolean {
    return this.cache.has(frame)
  }

  get size(): number {
    return this.cache.size
  }

  deleteMatching(predicate: (frame: number) => boolean): void {
    for (const [frame, entry] of this.cache.entries()) {
      if (!predicate(frame)) continue
      this.cache.delete(frame)
      this.releaseSlot(entry)
    }
  }

  clear(): void {
    this.cache.clear()
    this.resetFreeSlots()
  }

  dispose(): void {
    this.disposeStorage()
    this.device = null
    this.texW = 0
    this.texH = 0
  }

  getStats(): GpuTextureCacheStats {
    return {
      capacity: this.maxFrames,
      estimatedBytes:
        this.texW * this.texH * 4 * (this.arrayBacked ? this.maxFrames : this.slots.length),
      allocations: this.allocationCount,
      evictions: this.evictionCount,
      uploads: this.uploadCount,
      arrayBacked: this.arrayBacked,
    }
  }

  private disposeStorage(): void {
    this.cache.clear()
    if (this.storageTexture) this.storageTexture.destroy()
    else for (const entry of this.slots) entry.texture.destroy()
    this.storageTexture = null
    this.slots = []
    this.freeSlotIndices = []
    this.arrayBacked = false
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — Per-Video Last-Frame Cache
// ---------------------------------------------------------------------------

export type Tier2VideoFrame = ImageBitmap | VideoFrame

export interface VideoFrameEntry {
  frame: Tier2VideoFrame
  sourceTime: number
}

interface StoredVideoFrameEntry extends VideoFrameEntry {
  byteSize: number
  lastUsed: number
}

function getDecodedFrameAllocationSize(frame: Tier2VideoFrame): number {
  const allocationSize = (frame as VideoFrame & { allocationSize?: () => number }).allocationSize
  if (typeof allocationSize !== 'function') return 0
  try {
    const bytes = allocationSize.call(frame)
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  } catch {
    return 0
  }
}

function getDecodedFrameDimensions(
  frame: Tier2VideoFrame,
): { width: number; height: number } | null {
  const dimensions = frame as Tier2VideoFrame & {
    width?: number
    height?: number
    displayWidth?: number
    displayHeight?: number
  }
  const width = Number(dimensions.displayWidth ?? dimensions.width ?? 0)
  const height = Number(dimensions.displayHeight ?? dimensions.height ?? 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width: Math.round(width), height: Math.round(height) }
}

function estimateDecodedFrameBytes(frame: Tier2VideoFrame): number {
  const allocationBytes = getDecodedFrameAllocationSize(frame)
  if (allocationBytes > 0) return allocationBytes
  const dimensions = getDecodedFrameDimensions(frame)
  return dimensions ? dimensions.width * dimensions.height * 4 : 0
}

class VideoFrameCache {
  private cache = new Map<string, StoredVideoFrameEntry[]>()
  private maxEntriesPerItem: number
  private readonly maxBytes: number
  private totalBytes = 0
  private accessClock = 0
  private evictionCount = 0

  constructor(maxEntriesPerItem = 4, maxBytes = Number.POSITIVE_INFINITY) {
    this.maxEntriesPerItem = Math.max(1, maxEntriesPerItem)
    this.maxBytes = Math.max(1, maxBytes)
  }

  get(
    itemId: string,
    sourceTime?: number,
    maxSourceTimeDelta = Number.POSITIVE_INFINITY,
  ): VideoFrameEntry | undefined {
    const entries = this.cache.get(itemId)
    if (!entries || entries.length === 0) {
      return undefined
    }

    if (sourceTime === undefined) {
      return entries[entries.length - 1]
    }

    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const distance = Math.abs(entry.sourceTime - sourceTime)
      if (distance > maxSourceTimeDelta || distance >= bestDistance) {
        continue
      }
      bestDistance = distance
      bestIndex = i
    }

    if (bestIndex === -1) {
      return undefined
    }

    const [entry] = entries.splice(bestIndex, 1)
    entry!.lastUsed = ++this.accessClock
    entries.push(entry!)
    return entry
  }

  put(itemId: string, frame: Tier2VideoFrame, sourceTime: number): void {
    const entries = this.cache.get(itemId) ?? []
    const existingIndex = entries.findIndex(
      (entry) => Math.abs(entry.sourceTime - sourceTime) <= Number.EPSILON,
    )
    if (existingIndex !== -1) {
      const [existing] = entries.splice(existingIndex, 1)
      this.totalBytes -= existing?.byteSize ?? 0
      existing?.frame.close()
    }

    const entry: StoredVideoFrameEntry = {
      frame,
      sourceTime,
      byteSize: estimateDecodedFrameBytes(frame),
      lastUsed: ++this.accessClock,
    }
    entries.push(entry)
    this.totalBytes += entry.byteSize
    while (entries.length > this.maxEntriesPerItem) {
      this.evictEntry(itemId, entries, 0)
    }

    if (entries.length > 0) this.cache.set(itemId, entries)

    while (this.totalBytes > this.maxBytes) {
      const victim = this.findOldestEntry()
      if (!victim) break
      this.evictEntry(victim.itemId, victim.entries, victim.index)
    }
  }

  private findOldestEntry(): {
    itemId: string
    entries: StoredVideoFrameEntry[]
    index: number
  } | null {
    let oldest: {
      itemId: string
      entries: StoredVideoFrameEntry[]
      index: number
      lastUsed: number
    } | null = null
    for (const [itemId, entries] of this.cache) {
      for (let index = 0; index < entries.length; index++) {
        const candidate = entries[index]!
        if (!oldest || candidate.lastUsed < oldest.lastUsed) {
          oldest = { itemId, entries, index, lastUsed: candidate.lastUsed }
        }
      }
    }
    return oldest
  }

  private evictEntry(itemId: string, entries: StoredVideoFrameEntry[], index: number): void {
    const [evicted] = entries.splice(index, 1)
    if (!evicted) return
    this.totalBytes = Math.max(0, this.totalBytes - evicted.byteSize)
    evicted.frame.close()
    this.evictionCount++
    if (entries.length === 0) this.cache.delete(itemId)
  }

  has(itemId: string): boolean {
    return this.cache.has(itemId)
  }

  get size(): number {
    let total = 0
    for (const entries of this.cache.values()) {
      total += entries.length
    }
    return total
  }

  get bytes(): number {
    return this.totalBytes
  }

  get budgetBytes(): number {
    return this.maxBytes
  }

  get evictions(): number {
    return this.evictionCount
  }

  clear(): void {
    for (const entries of this.cache.values()) {
      for (const entry of entries) {
        entry.frame.close()
      }
    }
    this.cache.clear()
    this.totalBytes = 0
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — RAM Preview (Deep ImageBitmap Buffer)
// ---------------------------------------------------------------------------

class RamPreviewCache {
  private cache = new Map<number, ImageBitmap>()
  private maxFrames: number
  private maxBytes: number
  private currentBytes = 0
  private bytesPerFrame = 0
  private hint: EvictionHint | null = null

  constructor(maxFrames: number, maxBytes: number) {
    this.maxFrames = maxFrames
    this.maxBytes = maxBytes
  }

  setEvictionHint(hint: EvictionHint): void {
    this.hint = hint
  }

  setDimensions(width: number, height: number): boolean {
    const nextBytesPerFrame = width * height * 4
    if (this.bytesPerFrame === nextBytesPerFrame) return false
    if (this.bytesPerFrame !== 0) this.clear()
    this.bytesPerFrame = nextBytesPerFrame
    return true
  }

  get(frame: number): ImageBitmap | undefined {
    const bitmap = this.cache.get(frame)
    if (!bitmap) return undefined
    // LRU touch
    this.cache.delete(frame)
    this.cache.set(frame, bitmap)
    return bitmap
  }

  getNearest(
    frame: number,
    maxDistanceFrames: number,
  ): { frame: number; bitmap: ImageBitmap } | undefined {
    const nearestFrame = findNearestFrame(this.cache.keys(), frame, maxDistanceFrames)
    if (nearestFrame === undefined) return undefined
    const bitmap = this.get(nearestFrame)
    return bitmap ? { frame: nearestFrame, bitmap } : undefined
  }

  put(frame: number, bitmap: ImageBitmap): void {
    if (this.cache.has(frame)) {
      bitmap.close()
      return
    }

    // Evict until within both limits — prefer frames in opposite scrub direction
    while (
      (this.cache.size >= this.maxFrames ||
        this.currentBytes + this.bytesPerFrame > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const victim = this.pickEvictionVictim()
      if (victim === undefined) break
      const old = this.cache.get(victim)!
      old.close()
      this.cache.delete(victim)
      this.currentBytes -= this.bytesPerFrame
    }

    this.cache.set(frame, bitmap)
    this.currentBytes += this.bytesPerFrame
  }

  private pickEvictionVictim(): number | undefined {
    if (!this.hint || this.hint.direction === 0) {
      return this.cache.keys().next().value
    }
    const { currentFrame, direction } = this.hint
    for (const frame of this.cache.keys()) {
      if (direction > 0 ? frame < currentFrame : frame > currentFrame) {
        return frame
      }
    }
    return this.cache.keys().next().value
  }

  has(frame: number): boolean {
    return this.cache.has(frame)
  }

  get size(): number {
    return this.cache.size
  }

  get bytes(): number {
    return this.currentBytes
  }

  get budgetBytes(): number {
    return this.maxBytes
  }

  deleteMatching(predicate: (frame: number) => boolean): void {
    for (const [frame, bitmap] of this.cache.entries()) {
      if (!predicate(frame)) continue
      bitmap.close()
      this.cache.delete(frame)
      this.currentBytes -= this.bytesPerFrame
    }
    this.currentBytes = Math.max(0, this.currentBytes)
  }

  clear(): void {
    for (const bitmap of this.cache.values()) {
      bitmap.close()
    }
    this.cache.clear()
    this.currentBytes = 0
  }
}

// ---------------------------------------------------------------------------
// ScrubbingCache — Unified 3-Tier Interface
// ---------------------------------------------------------------------------

export interface ScrubbingCacheStats {
  tier1Size: number
  tier1Capacity: number
  tier1Bytes: number
  tier1Allocations: number
  tier1Evictions: number
  tier1Uploads: number
  tier1ArrayBacked: boolean
  tier2Size: number
  tier3Size: number
  tier1Hits: number
  tier2Hits: number
  tier3Hits: number
  nearestFrameHits: number
  misses: number
  tier3Bytes: number
  tier3BudgetBytes: number
  pendingRamFrames: number
  tier2Bytes: number
  tier2BudgetBytes: number
  tier2Evictions: number
}

const DEFAULT_MAX_RAM_FRAMES = 900
const FALLBACK_RAM_CACHE_BUDGET_BYTES = 384_000_000
const MIN_RAM_CACHE_BUDGET_BYTES = 256_000_000
const MAX_RAM_CACHE_BUDGET_BYTES = 1_000_000_000
const RAM_CACHE_SYSTEM_MEMORY_FRACTION = 0.0625
const MAX_PENDING_RAM_FRAME_COPIES = 2
const FALLBACK_DECODED_FRAME_CACHE_BUDGET_BYTES = 192_000_000
const MIN_DECODED_FRAME_CACHE_BUDGET_BYTES = 128_000_000
const MAX_DECODED_FRAME_CACHE_BUDGET_BYTES = 512_000_000
const DECODED_FRAME_CACHE_SYSTEM_MEMORY_FRACTION = 0.03125

export function resolveScrubbingRamBudgetBytes(deviceMemoryGb?: number): number {
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb)) {
    return FALLBACK_RAM_CACHE_BUDGET_BYTES
  }
  return Math.max(
    MIN_RAM_CACHE_BUDGET_BYTES,
    Math.min(
      MAX_RAM_CACHE_BUDGET_BYTES,
      Math.round(deviceMemoryGb * RAM_CACHE_SYSTEM_MEMORY_FRACTION * 1_000_000_000),
    ),
  )
}

function getDefaultRamCacheBudgetBytes(): number {
  const deviceMemoryGb =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { deviceMemory?: number }).deviceMemory
  return resolveScrubbingRamBudgetBytes(deviceMemoryGb)
}

export function resolveDecodedFrameBudgetBytes(deviceMemoryGb?: number): number {
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb)) {
    return FALLBACK_DECODED_FRAME_CACHE_BUDGET_BYTES
  }
  return Math.max(
    MIN_DECODED_FRAME_CACHE_BUDGET_BYTES,
    Math.min(
      MAX_DECODED_FRAME_CACHE_BUDGET_BYTES,
      Math.round(deviceMemoryGb * DECODED_FRAME_CACHE_SYSTEM_MEMORY_FRACTION * 1_000_000_000),
    ),
  )
}

function getDefaultDecodedFrameCacheBudgetBytes(): number {
  const deviceMemoryGb =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { deviceMemory?: number }).deviceMemory
  return resolveDecodedFrameBudgetBytes(deviceMemoryGb)
}

export class ScrubbingCache {
  private tier1: GpuTextureCache
  private tier2: VideoFrameCache
  private tier3: RamPreviewCache

  // Stats
  private _tier1Hits = 0
  private _tier2Hits = 0
  private _tier3Hits = 0
  private _nearestFrameHits = 0
  private _misses = 0
  private ramGeneration = 0
  private disposed = false
  private pendingRamFrames = new Map<number, number>()
  private invalidatedPendingRamFrames = new Set<number>()

  // GPU blit resources (for Tier 1 cache hit rendering)
  private blitPipeline: GPURenderPipeline | null = null
  private blitBindGroupLayout: GPUBindGroupLayout | null = null
  private blitSampler: GPUSampler | null = null
  private blitCanvas: OffscreenCanvas | null = null
  private blitCtx: GPUCanvasContext | null = null
  private blitDevice: GPUDevice | null = null
  private blitFormat: GPUTextureFormat = 'rgba8unorm'
  private blitW = 0
  private blitH = 0

  constructor(
    maxGpuFrames = 300,
    maxRamFrames = DEFAULT_MAX_RAM_FRAMES,
    maxRamBytes = getDefaultRamCacheBudgetBytes(),
    maxDecodedFrameBytes = getDefaultDecodedFrameCacheBudgetBytes(),
  ) {
    this.tier1 = new GpuTextureCache(maxGpuFrames)
    this.tier2 = new VideoFrameCache(4, maxDecodedFrameBytes)
    this.tier3 = new RamPreviewCache(maxRamFrames, maxRamBytes)
  }

  /**
   * Connect the GPU device (deferred — called after EffectsPipeline initializes).
   * Enables Tier 1 caching and GPU blit for cache hits.
   */
  setGpuDevice(device: GPUDevice, width: number, height: number): void {
    const deviceChanged = this.blitDevice !== device
    this.tier1.setDevice(device, width, height)
    if (this.tier3.setDimensions(width, height)) {
      this.invalidateAllPendingRamFrames()
    }

    if (deviceChanged) {
      this.blitDevice = device
      this.blitFormat = navigator.gpu.getPreferredCanvasFormat()
      this.blitSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
      this.initBlitPipeline(device)
      this.blitCanvas = null
      this.blitCtx = null
    }

    if (this.blitW !== width || this.blitH !== height) {
      this.blitW = width
      this.blitH = height
      this.blitCanvas = null
      this.blitCtx = null
    }
  }

  // -----------------------------------------------------------------------
  // Eviction hints
  // -----------------------------------------------------------------------

  /**
   * Update the scrub direction hint used for cache eviction.
   * When direction is known, eviction prefers frames in the opposite
   * direction — preserving frames the user is scrubbing toward.
   * Call on every scrub position change (cheap, just stores two numbers).
   */
  setEvictionHint(currentFrame: number, direction: -1 | 0 | 1): void {
    const hint: EvictionHint = { currentFrame, direction }
    this.tier1.setEvictionHint(hint)
    this.tier3.setEvictionHint(hint)
  }

  // -----------------------------------------------------------------------
  // Tier 1 — VRAM texture cache
  // -----------------------------------------------------------------------

  /** Check Tier 1 GPU cache. Returns an OffscreenCanvas with the frame if hit. */
  getGpuFrame(frame: number): OffscreenCanvas | null {
    const entry = this.tier1.get(frame)
    if (!entry) return null

    const canvas = this.blitToCanvas(entry)
    if (canvas) {
      this._tier1Hits++
      return canvas
    }
    return null
  }

  /** Upload a composited frame to Tier 1 GPU cache. */
  putGpuFrame(frame: number, source: ImageBitmap | OffscreenCanvas): void {
    this.tier1.put(frame, source)
  }

  // -----------------------------------------------------------------------
  // Tier 2 — Per-video last-frame cache
  // -----------------------------------------------------------------------

  /** Get the last decoded frame for a video item (for instant clip-boundary display). */
  getVideoFrameEntry(
    itemId: string,
    sourceTime?: number,
    maxSourceTimeDelta = Number.POSITIVE_INFINITY,
  ): VideoFrameEntry | undefined {
    const entry = this.tier2.get(itemId, sourceTime, maxSourceTimeDelta)
    if (!entry) {
      return undefined
    }
    this._tier2Hits++
    return entry
  }

  /** Cache a decoded video frame for a specific item. */
  putVideoFrame(itemId: string, frame: Tier2VideoFrame, sourceTime: number): void {
    this.tier2.put(itemId, frame, sourceTime)
  }

  // -----------------------------------------------------------------------
  // Tier 3 — RAM Preview (deep ImageBitmap buffer)
  // -----------------------------------------------------------------------

  /** Check Tier 3 RAM cache. Returns ImageBitmap if hit. */
  getRamFrame(frame: number): ImageBitmap | undefined {
    const bitmap = this.tier3.get(frame)
    if (bitmap) {
      this._tier3Hits++
      // Promote to Tier 1 on access
      this.tier1.put(frame, bitmap)
      return bitmap
    }
    return undefined
  }

  /** Store a composited frame in Tier 3 RAM cache. */
  putRamFrame(frame: number, bitmap: ImageBitmap): void {
    this.tier3.put(frame, bitmap)
  }

  // -----------------------------------------------------------------------
  // Unified lookup (Tier 1 → Tier 3 → miss)
  // -----------------------------------------------------------------------

  /**
   * Try all tiers. Returns an ImageBitmap or OffscreenCanvas on hit, null on miss.
   * Tier 2 (per-video) is NOT checked here — it's item-level, not frame-level.
   */
  getFrame(frame: number): ImageBitmap | OffscreenCanvas | null {
    // Tier 1 — GPU texture (fastest: ~0.1ms blit)
    const gpuResult = this.getGpuFrame(frame)
    if (gpuResult) return gpuResult

    // Tier 3 — RAM ImageBitmap (promotes to Tier 1 on access)
    const ramResult = this.getRamFrame(frame)
    if (ramResult) return ramResult

    this._misses++
    return null
  }

  /**
   * Return the closest cached full composite inside a small temporal window.
   * This is provisional only: callers must keep decoding the exact target.
   */
  getNearestFrame(
    frame: number,
    maxDistanceFrames: number,
  ): { frame: number; source: ImageBitmap | OffscreenCanvas } | null {
    const gpuResult = this.tier1.getNearest(frame, maxDistanceFrames)
    if (gpuResult) {
      const source = this.blitToCanvas(gpuResult.entry)
      if (source) {
        this._tier1Hits++
        this._nearestFrameHits++
        return { frame: gpuResult.frame, source }
      }
    }

    const ramResult = this.tier3.getNearest(frame, maxDistanceFrames)
    if (!ramResult) return null
    this._tier3Hits++
    this._nearestFrameHits++
    this.tier1.put(ramResult.frame, ramResult.bitmap)
    return { frame: ramResult.frame, source: ramResult.bitmap }
  }

  /**
   * Cache a fully composited frame into Tier 1 + Tier 3.
   * Call after renderFrame() completes.
   *
   * Tier 1 (GPU) is always populated via copyExternalImageToTexture
   * (near-free: <0.5ms CPU, GPU handles the copy asynchronously).
   * Tier 3 (RAM) uses createImageBitmap (~2-5ms) and can be skipped
   * during sequential forward playback where mediabunny decode is cheaper.
   *
   * @param gpuOnly - When true, only populate Tier 1 (GPU). Use during
   *   sequential forward playback to avoid createImageBitmap overhead
   *   while still building GPU cache for backward scrub coverage.
   */
  cacheFrame(frame: number, canvas: OffscreenCanvas, gpuOnly = false): void {
    if (this.disposed) return
    // Tier 1: GPU upload directly from canvas (near-free)
    if (!this.tier1.has(frame)) {
      this.tier1.put(frame, canvas)
    }

    if (gpuOnly) return

    // Tier 3: RAM buffer (async bitmap creation in background)
    if (
      !this.tier3.has(frame) &&
      !this.pendingRamFrames.has(frame) &&
      this.pendingRamFrames.size < MAX_PENDING_RAM_FRAME_COPIES
    ) {
      const generation = this.ramGeneration
      this.pendingRamFrames.set(frame, generation)
      void createImageBitmap(canvas).then(
        (bitmap) => {
          const pendingGeneration = this.pendingRamFrames.get(frame)
          this.pendingRamFrames.delete(frame)
          const invalidated = this.invalidatedPendingRamFrames.delete(frame)
          if (
            !this.disposed &&
            !invalidated &&
            pendingGeneration === generation &&
            generation === this.ramGeneration &&
            !this.tier3.has(frame)
          ) {
            this.tier3.put(frame, bitmap)
          } else {
            bitmap.close()
          }
        },
        () => {
          this.pendingRamFrames.delete(frame)
          this.invalidatedPendingRamFrames.delete(frame)
        },
      )
    }
  }

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  /** Evict specific cached frames, cached frame ranges, or flush all tiers. */
  invalidate(request?: FrameInvalidationRequest): void {
    if (!request || !hasFrameInvalidation(request)) {
      this.invalidateAllPendingRamFrames()
      this.tier1.clear()
      this.tier3.clear()
      return
    }

    const explicitFrames = request.frames ? new Set(request.frames) : null
    const ranges = request.ranges ?? []
    const shouldDeleteFrame = (frame: number) =>
      (explicitFrames?.has(frame) ?? false) || isFrameInRanges(frame, ranges)

    for (const frame of this.pendingRamFrames.keys()) {
      if (shouldDeleteFrame(frame)) this.invalidatedPendingRamFrames.add(frame)
    }
    this.tier1.deleteMatching(shouldDeleteFrame)
    this.tier3.deleteMatching(shouldDeleteFrame)
  }

  /** Clear Tier 2 (per-video last-frame). Call when timeline items change. */
  invalidateVideoFrames(): void {
    this.tier2.clear()
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): ScrubbingCacheStats {
    const gpuStats = this.tier1.getStats()
    return {
      tier1Size: this.tier1.size,
      tier1Capacity: gpuStats.capacity,
      tier1Bytes: gpuStats.estimatedBytes,
      tier1Allocations: gpuStats.allocations,
      tier1Evictions: gpuStats.evictions,
      tier1Uploads: gpuStats.uploads,
      tier1ArrayBacked: gpuStats.arrayBacked,
      tier2Size: this.tier2.size,
      tier3Size: this.tier3.size,
      tier1Hits: this._tier1Hits,
      tier2Hits: this._tier2Hits,
      tier3Hits: this._tier3Hits,
      nearestFrameHits: this._nearestFrameHits,
      misses: this._misses,
      tier3Bytes: this.tier3.bytes,
      tier3BudgetBytes: this.tier3.budgetBytes,
      pendingRamFrames: this.pendingRamFrames.size,
      tier2Bytes: this.tier2.bytes,
      tier2BudgetBytes: this.tier2.budgetBytes,
      tier2Evictions: this.tier2.evictions,
    }
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  dispose(): void {
    this.disposed = true
    this.invalidateAllPendingRamFrames()
    this.tier1.dispose()
    this.tier2.clear()
    this.tier3.clear()
    this.blitCanvas = null
    this.blitCtx = null
    this.blitPipeline = null
    this.blitBindGroupLayout = null
    this.blitSampler = null
    this.blitDevice = null
  }

  private invalidateAllPendingRamFrames(): void {
    this.ramGeneration++
    this.invalidatedPendingRamFrames.clear()
  }

  // -----------------------------------------------------------------------
  // GPU blit internals (Tier 1 cache hit → OffscreenCanvas)
  // -----------------------------------------------------------------------

  private initBlitPipeline(device: GPUDevice): void {
    const BLIT_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
  );
  var uv = array<vec2f, 6>(
    vec2f(0, 1), vec2f(1, 1), vec2f(0, 0),
    vec2f(0, 0), vec2f(1, 1), vec2f(1, 0)
  );
  var o: VertexOutput;
  o.position = vec4f(pos[vi], 0, 1);
  o.uv = uv[vi];
  return o;
}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}`

    const module = device.createShaderModule({ label: 'scrub-cache-blit', code: BLIT_SHADER })
    this.blitBindGroupLayout = device.createBindGroupLayout({
      label: 'scrub-cache-blit-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    })
    this.blitPipeline = device.createRenderPipeline({
      label: 'scrub-cache-blit-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.blitBindGroupLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.blitFormat }] },
      primitive: { topology: 'triangle-list' },
    })
  }

  private blitToCanvas(entry: GpuCacheEntry): OffscreenCanvas | null {
    if (!this.blitDevice || !this.blitPipeline || !this.blitBindGroupLayout || !this.blitSampler) {
      return null
    }

    if (
      !this.blitCanvas ||
      this.blitCanvas.width !== this.blitW ||
      this.blitCanvas.height !== this.blitH
    ) {
      this.blitCanvas = new OffscreenCanvas(this.blitW, this.blitH)
      const ctx = this.blitCanvas.getContext('webgpu') as GPUCanvasContext | null
      if (!ctx) return null
      ctx.configure({
        device: this.blitDevice,
        format: this.blitFormat,
        alphaMode: 'premultiplied',
      })
      this.blitCtx = ctx
    }
    if (!this.blitCtx) return null

    const bindGroup =
      entry.blitBindGroup ??
      (entry.blitBindGroup = this.blitDevice.createBindGroup({
        layout: this.blitBindGroupLayout,
        entries: [
          { binding: 0, resource: this.blitSampler },
          { binding: 1, resource: entry.view },
        ],
      }))

    const encoder = this.blitDevice.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.blitCtx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.blitPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
    this.blitDevice.queue.submit([encoder.finish()])

    return this.blitCanvas
  }
}
