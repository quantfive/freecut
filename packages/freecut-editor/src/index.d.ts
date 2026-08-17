import type { ComponentType, ReactNode } from 'react'

export type EditorCapability =
  | 'project.navigate'
  | 'project.save'
  | 'media.resolve'
  | 'media.import'
  | 'media.delete'
  | 'media.proxy'
  | 'media.transcription'
  | 'media.relink'
  | 'timeline.add'
  | 'timeline.move'
  | 'timeline.trim'
  | 'timeline.split'
  | 'timeline.remove'
  | 'timeline.track'
  | 'workspace.edit'
  | 'workspace.color'
  | 'workspace.motion'
  | 'export.video'
  | 'export.bundle'
  | 'render.queue'

export type EditorCapabilityMap = Readonly<Partial<Record<EditorCapability, boolean>>>

export type HostMediaKind = 'video' | 'audio' | 'image' | 'lottie'

export interface MediaLocator {
  mediaId: string
  kind: HostMediaKind
  variant?: 'source' | 'proxy' | 'thumbnail'
}

export interface ResolvedMediaLocator {
  source: string
  audioSource?: string
  expiresAt?: number
}

export interface EmbeddedEditorProject {
  id: string
  name: string
  width: number
  height: number
  fps: number
  backgroundColor?: string
}

export interface MediaReference {
  media_id: string
  media_kind: Exclude<HostMediaKind, 'lottie'>
  content_hash: string
  duration_us: number | null
  availability:
    | {
        mode: 'local'
        local: { device_id: string; root_id: string; file_id: string; root_generation: number }
      }
    | { mode: 'cloud'; cloud: { object_id: string } }
    | {
        mode: 'hybrid'
        local: { device_id: string; root_id: string; file_id: string; root_generation: number }
        cloud: { object_id: string }
      }
}

export type FrameRateLike = number | { numerator: bigint; denominator: bigint; value: number }

export interface FreeCutFrameClip {
  type: 'video' | 'audio' | 'image'
  id: string
  trackId: string
  mediaId: string
  from: number
  durationInFrames: number
  sourceStart?: number
  sourceEnd?: number
  volume?: number
  speed?: number
  opacity?: number
  transform?: Record<string, number>
}

export interface FreeCutFrameText {
  type: 'text'
  id: string
  trackId: string
  from: number
  durationInFrames: number
  text: string
  style?: Record<string, string | number>
  opacity?: number
  transform?: Record<string, number>
}

export interface FreeCutFrameCaptionCue {
  type: 'caption_cue'
  id: string
  trackId: string
  from: number
  durationInFrames: number
  text: string
  speaker?: string | null
}

export type FreeCutFrameItem = FreeCutFrameClip | FreeCutFrameText | FreeCutFrameCaptionCue

export interface FreeCutFrameTrack {
  id: string
  kind: 'video' | 'audio' | 'overlay' | 'caption'
  name: string
  language?: string
  locked: boolean
  muted: boolean
  items: readonly FreeCutFrameItem[]
}

export interface FreeCutFrameDocument {
  timelineId: string
  revision: number
  fps: FrameRateLike
  durationInFrames: number
  media: readonly MediaReference[]
  tracks: readonly FreeCutFrameTrack[]
  width: number
  height: number
  backgroundColor?: string
}

export interface EmbeddedEditorAsset {
  id: string
  kind: HostMediaKind
  fileName: string
  mimeType: string
  durationSeconds: number
  width: number
  height: number
  fps: number
  fileSize?: number
  contentHash?: string
  thumbnailLocator?: MediaLocator
}

export interface EmbeddedEditorSnapshot {
  project: EmbeddedEditorProject
  timeline: FreeCutFrameDocument
  assets: readonly EmbeddedEditorAsset[]
}

export interface HostNotice {
  kind: 'info' | 'warning' | 'error' | 'unsupported' | 'conflict'
  message: string
  operationId?: string
}

export interface HostAppliedEditResult {
  status: 'applied' | 'replayed'
  snapshot: EmbeddedEditorSnapshot
  result: Record<string, unknown>
}

export interface HostConflictResult {
  status: 'conflict' | 'rejected'
  snapshot: EmbeddedEditorSnapshot
  result: Record<string, unknown>
}

export type HostEditResult = HostAppliedEditResult | HostConflictResult

export interface EditCommand {
  type: string
  command_id?: string
  [field: string]: unknown
}

export interface EditCommandBatch {
  contract_version: 1
  timeline_id: string
  operation_id: string
  idempotency_key: string
  base_revision: number
  preconditions: readonly object[]
  commands: readonly EditCommand[]
}

export interface EditorHostNavigation {
  back(): void
}

export interface EditorHost {
  readonly capabilities: EditorCapabilityMap
  load(): Promise<EmbeddedEditorSnapshot> | EmbeddedEditorSnapshot
  resolveMedia(
    locator: MediaLocator,
  ): Promise<ResolvedMediaLocator | null> | ResolvedMediaLocator | null
  submitEdit(batch: EditCommandBatch): Promise<HostEditResult> | HostEditResult
  navigation?: EditorHostNavigation
  notify?(notice: HostNotice): void
}

export type LocalEditorHostOptions = Omit<EditorHost, 'capabilities'> & {
  capabilities?: EditorCapabilityMap
}

export interface EditorHostContextValue {
  mode: 'local' | 'host'
  capabilities: EditorCapabilityMap
  host?: EditorHost
}

export interface EditorHostProviderProps {
  value: EditorHostContextValue
  children: ReactNode
}

export interface FreeCutEditorSurfaceProps {
  host: EditorHost
}

export declare const FreeCutEditorSurface: ComponentType<FreeCutEditorSurfaceProps>
export declare const EditorHostProvider: ComponentType<EditorHostProviderProps>
export declare const DEFAULT_HOST_CAPABILITIES: EditorCapabilityMap
export declare const SUPPORTED_HOST_COMMANDS: readonly [
  'add_clip',
  'add_text',
  'move_item',
  'trim_item',
  'split_item',
  'remove_item',
  'add_track',
]
export declare function capabilityForCommand(command: string): EditorCapability | null
export declare function isHostCapabilityEnabled(
  capabilities: EditorCapabilityMap,
  capability: EditorCapability,
): boolean
export declare function createLocalEditorHost(options: LocalEditorHostOptions): EditorHost
