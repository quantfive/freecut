import {
  freeCutDocumentToControlledDocument,
  type FreeCutFrameDocument,
  type FreeCutFrameItem,
} from '@/features/editor/codepress/document'
import type { EmbeddedEditorAsset, EmbeddedEditorSnapshot } from './contract'
import type { ControlledEditorDocument } from '@/features/editor/codepress/interfaces'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TimelineState } from '@/features/editor/deps/timeline-store'
import type { MediaMetadata } from '@/types/storage'
import { DEFAULT_TRACK_HEIGHT } from '@/shared/timeline/defaults'

export interface HostNativeTimeline {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  fps: number
}

export interface NativeTimelineConversionFailure {
  reason: string
  itemId?: string
}

export type NativeTimelineConversionResult =
  | { ok: true; document: FreeCutFrameDocument }
  | { ok: false; failure: NativeTimelineConversionFailure }

function safeDurationFrames(asset: EmbeddedEditorAsset, fps: number): number {
  if (!Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0) return 1
  return Math.max(1, Math.round(asset.durationSeconds * fps))
}

// fallow-ignore-next-line complexity
function nativeTransformToFrame(
  transform: TimelineItem['transform'],
): Record<string, number> | undefined {
  if (!transform) return undefined
  return {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    width: transform.width ?? 0,
    height: transform.height ?? 0,
    anchorX: transform.anchorX ?? 0,
    anchorY: transform.anchorY ?? 0,
    rotation: transform.rotation ?? 0,
    opacity: transform.opacity ?? 1,
  }
}

function frameTransformToNative(
  transform: Record<string, number> | undefined,
): NonNullable<TimelineItem['transform']> | undefined {
  if (!transform) return undefined
  return {
    x: transform.x ?? transform.position_x ?? 0,
    y: transform.y ?? transform.position_y ?? 0,
    width: transform.width,
    height: transform.height,
    anchorX: transform.anchorX ?? transform.anchor_x,
    anchorY: transform.anchorY ?? transform.anchor_y,
    rotation: transform.rotation ?? transform.rotation_degrees,
    opacity: transform.opacity,
  }
}

function assetById(assets: readonly EmbeddedEditorAsset[]): Map<string, EmbeddedEditorAsset> {
  return new Map(assets.map((asset) => [asset.id, asset]))
}

function mediaMetadataFromAsset(asset: EmbeddedEditorAsset): MediaMetadata {
  return {
    id: asset.id,
    // Host assets are intentionally not represented as workspace, OPFS, or
    // File System Access records.  Their source is resolved by the host port.
    storageType: 'host',
    contentHash: asset.contentHash,
    fileName: asset.fileName,
    fileSize: asset.fileSize ?? 0,
    mimeType: asset.mimeType,
    duration: asset.durationSeconds,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
    codec: 'host-managed',
    bitrate: 0,
    thumbnailId: undefined,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

export function hostAssetsToMediaMetadata(assets: readonly EmbeddedEditorAsset[]): MediaMetadata[] {
  return assets.map(mediaMetadataFromAsset)
}

function nativeTrackFromHostTrack(
  track: FreeCutFrameDocument['tracks'][number],
  index: number,
): TimelineTrack {
  const kind = track.kind === 'audio' ? 'audio' : 'video'
  return {
    id: track.id,
    name: track.name,
    kind,
    height: DEFAULT_TRACK_HEIGHT,
    locked: track.locked,
    syncLock: true,
    visible: true,
    muted: track.muted,
    solo: false,
    order: index,
    items: [],
  }
}

// fallow-ignore-next-line complexity
function nativeItemFromHostItem(
  item: FreeCutFrameItem,
  assets: Map<string, EmbeddedEditorAsset>,
): TimelineItem {
  if (item.type === 'text') {
    const textColor = typeof item.style?.color === 'string' ? item.style.color : '#ffffff'
    return {
      id: item.id,
      type: 'text',
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      label: item.text || 'Text',
      text: item.text,
      color: textColor,
      ...(typeof item.style?.font_family === 'string'
        ? { fontFamily: item.style.font_family }
        : {}),
      ...(typeof item.style?.font_size === 'number' ? { fontSize: item.style.font_size } : {}),
      ...(item.style?.alignment === 'left' ||
      item.style?.alignment === 'center' ||
      item.style?.alignment === 'right'
        ? { textAlign: item.style.alignment }
        : {}),
      ...(item.opacity !== undefined ? { transform: { opacity: item.opacity } } : {}),
      ...(item.transform ? { transform: frameTransformToNative(item.transform) } : {}),
    }
  }

  if (item.type === 'caption_cue') {
    const style = item.style
    return {
      id: item.id,
      type: 'text',
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      label: item.text || 'Caption',
      text: item.text,
      textRole: 'caption',
      color: style?.color ?? '#ffffff',
      ...(typeof style?.font_family === 'string' ? { fontFamily: style.font_family } : {}),
      ...(typeof style?.font_size === 'number' ? { fontSize: style.font_size } : {}),
      ...(typeof style?.background_color === 'string'
        ? { backgroundColor: style.background_color }
        : {}),
      ...(style?.alignment === 'left' ||
      style?.alignment === 'center' ||
      style?.alignment === 'right'
        ? { textAlign: style.alignment }
        : {}),
    }
  }

  const asset = assets.get(item.mediaId)
  const sourceDuration = asset ? safeDurationFrames(asset, asset.fps || 30) : undefined
  const sourceStart = item.sourceStart ?? item.from
  const sourceEnd = item.sourceEnd ?? sourceStart + item.durationInFrames
  const common = {
    id: item.id,
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: asset?.fileName ?? item.mediaId,
    mediaId: item.mediaId,
    src: '',
    ...(sourceDuration !== undefined ? { sourceDuration } : {}),
    sourceStart,
    sourceEnd,
    ...(item.volume !== undefined ? { volume: item.volume } : {}),
    ...(item.speed !== undefined ? { speed: item.speed } : {}),
    ...(item.opacity !== undefined ? { transform: { opacity: item.opacity } } : {}),
    ...(item.transform ? { transform: frameTransformToNative(item.transform) } : {}),
  }

  if (item.type === 'audio') return { ...common, type: 'audio' }
  if (item.type === 'image') return { ...common, type: 'image' }
  return { ...common, type: 'video' }
}

export function hostSnapshotToNativeTimeline(snapshot: EmbeddedEditorSnapshot): HostNativeTimeline {
  const assets = assetById(snapshot.assets)
  const tracks = snapshot.timeline.tracks.map(nativeTrackFromHostTrack)
  const items = snapshot.timeline.tracks.flatMap((track) =>
    track.items.map((item) => nativeItemFromHostItem(item, assets)),
  )
  return { tracks, items, fps: snapshot.project.fps }
}

export function hostSnapshotToControlledDocument(
  snapshot: EmbeddedEditorSnapshot,
): ControlledEditorDocument {
  return freeCutDocumentToControlledDocument(snapshot.timeline)
}

export function hostSnapshotToProject(snapshot: EmbeddedEditorSnapshot) {
  return {
    id: snapshot.project.id,
    name: snapshot.project.name,
    description: '',
    duration: snapshot.timeline.durationInFrames / snapshot.project.fps,
    schemaVersion: 1,
    metadata: {
      width: snapshot.project.width,
      height: snapshot.project.height,
      fps: snapshot.project.fps,
      backgroundColor: snapshot.project.backgroundColor,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

// fallow-ignore-next-line complexity
function frameItemToNativeComparable(
  item: TimelineItem,
):
  | Extract<FreeCutFrameItem, { type: 'video' | 'audio' | 'image' }>
  | Extract<FreeCutFrameItem, { type: 'text' }>
  | Extract<FreeCutFrameItem, { type: 'caption_cue' }>
  | NativeTimelineConversionFailure {
  if (item.type === 'video' || item.type === 'audio' || item.type === 'image') {
    if (!item.mediaId) return { reason: `Media item "${item.id}" has no mediaId`, itemId: item.id }
    return {
      type: item.type,
      id: item.id,
      trackId: item.trackId,
      mediaId: item.mediaId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      volume: item.volume,
      speed: item.speed,
      opacity: item.transform?.opacity,
      transform: nativeTransformToFrame(item.transform),
    }
  }

  if (item.type === 'text' && item.textRole === 'caption') {
    const style = {
      ...(item.fontFamily ? { font_family: item.fontFamily } : {}),
      ...(item.fontSize !== undefined ? { font_size: item.fontSize } : {}),
      ...(item.color && item.color !== '#ffffff' ? { color: item.color } : {}),
      ...(item.backgroundColor ? { background_color: item.backgroundColor } : {}),
      ...(item.textAlign ? { alignment: item.textAlign } : {}),
    }
    return {
      type: 'caption_cue',
      id: item.id,
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      text: item.text,
      ...(Object.keys(style).length > 0 ? { style } : {}),
    }
  }

  if (item.type === 'text') {
    return {
      type: 'text',
      id: item.id,
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      text: item.text,
      style: {
        ...(item.fontFamily ? { font_family: item.fontFamily } : {}),
        ...(item.fontSize !== undefined ? { font_size: item.fontSize } : {}),
        ...(item.color && item.color !== '#ffffff' ? { color: item.color } : {}),
        ...(item.textAlign ? { alignment: item.textAlign } : {}),
      },
      opacity: item.transform?.opacity,
      transform: nativeTransformToFrame(item.transform),
    }
  }

  return { reason: `Unsupported native timeline item type "${item.type}"`, itemId: item.id }
}

/**
 * Convert only the bounded native editor shape back into the neutral frame
 * document.  Shapes, compositions, subtitles, Lottie, effects, and animation
 * edits fail closed so a host action can be visibly rejected and restored.
 */
export function nativeTimelineToFrameDocument(
  state: Pick<TimelineState, 'tracks' | 'items' | 'fps'>,
  authoritative: FreeCutFrameDocument,
): NativeTimelineConversionResult {
  const trackIds = new Set(state.tracks.map((track) => track.id))
  const itemsByTrack = new Map<string, FreeCutFrameItem[]>()
  for (const item of state.items) {
    if (!trackIds.has(item.trackId)) {
      return {
        ok: false,
        failure: {
          reason: `Timeline item "${item.id}" references a missing track`,
          itemId: item.id,
        },
      }
    }
    const converted = frameItemToNativeComparable(item)
    if ('reason' in converted) return { ok: false, failure: converted }
    const list = itemsByTrack.get(item.trackId) ?? []
    list.push(converted)
    itemsByTrack.set(item.trackId, list)
  }

  const tracks = state.tracks.map((track) => {
    const authoritativeTrack = authoritative.tracks.find((candidate) => candidate.id === track.id)
    return {
      id: track.id,
      kind:
        authoritativeTrack?.kind ??
        (track.kind === 'audio' ? ('audio' as const) : ('video' as const)),
      name: track.name,
      ...(authoritativeTrack?.language !== undefined
        ? { language: authoritativeTrack.language }
        : {}),
      locked: track.locked,
      muted: track.muted,
      ...(authoritativeTrack?.defaultStyle !== undefined
        ? { defaultStyle: authoritativeTrack.defaultStyle }
        : {}),
      items: itemsByTrack.get(track.id) ?? [],
    }
  })

  const durationInFrames = Math.max(
    authoritative.durationInFrames,
    ...state.items.map((item) => item.from + item.durationInFrames),
  )
  return {
    ok: true,
    document: {
      ...authoritative,
      revision: authoritative.revision,
      fps: state.fps,
      durationInFrames,
      tracks,
    },
  }
}
