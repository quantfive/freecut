import type { ComponentType, ReactNode } from 'react'

export type HotkeyKey =
  | 'PLAY_PAUSE'
  | 'SHUTTLE_REVERSE'
  | 'SHUTTLE_PAUSE'
  | 'SHUTTLE_FORWARD'
  | 'PREVIOUS_FRAME'
  | 'NEXT_FRAME'
  | 'GO_TO_START'
  | 'GO_TO_END'
  | 'NEXT_SNAP_POINT'
  | 'PREVIOUS_SNAP_POINT'
  | 'SPLIT_AT_PLAYHEAD'
  | 'SPLIT_AT_PLAYHEAD_ALT'
  | 'JOIN_ITEMS'
  | 'DELETE_SELECTED'
  | 'DELETE_SELECTED_ALT'
  | 'RIPPLE_DELETE'
  | 'RIPPLE_DELETE_ALT'
  | 'FREEZE_FRAME'
  | 'LINK_AUDIO_VIDEO'
  | 'UNLINK_AUDIO_VIDEO'
  | 'TOGGLE_LINKED_SELECTION'
  | 'NUDGE_LEFT'
  | 'NUDGE_RIGHT'
  | 'NUDGE_UP'
  | 'NUDGE_DOWN'
  | 'NUDGE_LEFT_LARGE'
  | 'NUDGE_RIGHT_LARGE'
  | 'NUDGE_UP_LARGE'
  | 'NUDGE_DOWN_LARGE'
  | 'UNDO'
  | 'REDO'
  | 'ZOOM_IN'
  | 'ZOOM_OUT'
  | 'ZOOM_TO_FIT'
  | 'ZOOM_TO_100'
  | 'ZOOM_TO_100_ALT'
  | 'COPY'
  | 'CUT'
  | 'PASTE'
  | 'SELECTION_TOOL'
  | 'TRIM_EDIT_TOOL'
  | 'RAZOR_TOOL'
  | 'RATE_STRETCH_TOOL'
  | 'SLIP_TOOL'
  | 'SLIDE_TOOL'
  | 'SAVE'
  | 'EXPORT'
  | 'TOGGLE_SNAP'
  | 'TOGGLE_CANVAS_SNAP'
  | 'OPEN_SCENE_BROWSER'
  | 'WORKSPACE_EDIT'
  | 'WORKSPACE_COLOR'
  | 'WORKSPACE_ANIMATE'
  | 'ADD_MARKER'
  | 'REMOVE_MARKER'
  | 'PREVIOUS_MARKER'
  | 'NEXT_MARKER'
  | 'CLEAR_KEYFRAMES'
  | 'KEYFRAME_EDITOR_GRAPH'
  | 'KEYFRAME_EDITOR_DOPESHEET'
  | 'KEYFRAME_EDITOR_SPLIT'
  | 'EDIT_KEYFRAME_ADD'
  | 'KEYFRAME_PREVIOUS'
  | 'KEYFRAME_NEXT'
  | 'KEYFRAME_TOGGLE_AUTO'
  | 'KEYFRAME_FIT'
  | 'MARK_IN'
  | 'MARK_OUT'
  | 'CLEAR_IN_OUT'
  | 'INSERT_EDIT'
  | 'OVERWRITE_EDIT'

export type HotkeyOverrideMap = Partial<Record<HotkeyKey, string>>

export declare const HOTKEYS: Readonly<Record<HotkeyKey, string>>

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
  | 'timeline.caption'
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

export interface CaptionStyle {
  font_family?: string
  font_size?: number
  color?: string
  background_color?: string
  background_opacity?: number
  alignment?: 'left' | 'center' | 'right'
}

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
  style?: CaptionStyle
}

export type FreeCutFrameItem = FreeCutFrameClip | FreeCutFrameText | FreeCutFrameCaptionCue

export interface FreeCutFrameTrack {
  id: string
  kind: 'video' | 'audio' | 'overlay' | 'caption'
  name: string
  language?: string
  locked: boolean
  muted: boolean
  defaultStyle?: CaptionStyle | null
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

export type HostEditPredicate =
  | 'metadata'
  | 'transform'
  | 'sourceRange'
  | 'track'
  | 'timelinePosition'

export interface HostEditRejectionDetail {
  code: 'unclassified_item_change' | 'ambiguous_change'
  itemId?: string
  failedPredicates?: readonly HostEditPredicate[]
  changedFields?: readonly string[]
  changeCounts?: Readonly<{ added: number; removed: number; changed: number }>
}

export interface HostNotice {
  kind: 'info' | 'warning' | 'error' | 'unsupported' | 'conflict'
  message: string
  operationId?: string
  /** Structured, value-free diagnostics for an `unsupported` rejection. */
  detail?: HostEditRejectionDetail
}

export declare const MAX_TRANSCRIPT_SELECTIONS: number
export declare const MAX_TRANSCRIPT_SECTION_PAGE_SIZE: number
export declare const MAX_TRANSCRIPT_SECTION_TEXT_BYTES: number
export declare const MAX_TRANSCRIPT_COMMAND_TEXT_BYTES: number
export declare const MAX_TRANSCRIPT_DURATION_US: number
export declare const MAX_TRANSCRIPT_CURSOR_LENGTH: number
export declare const MAX_TRANSCRIPT_QUERY_LENGTH: number

export type HostTranscriptStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'stale'
  | 'purged'

export interface HostTranscriptError {
  code: string
  message: string
  retryable: boolean
  details?: Readonly<Record<string, unknown>>
}

export interface HostTranscriptStatusReceipt {
  transcriptId: string
  assetId: string | null
  sourceAssetHash: string
  status: HostTranscriptStatus
  language?: string | null
  durationUs: number | null
  sectionCount: number
  error?: HostTranscriptError | null
}

export interface HostTranscriptSection {
  id: string
  transcriptId: string
  ordinal: number
  startUs: number
  endUs: number
  text: string
  speaker?: string | null
}

export interface HostTranscriptSectionsRequest {
  transcriptId: string
  cursor?: string | null
  limit?: number
  startUs?: number
  endUs?: number
}

export interface HostTranscriptSectionsPage {
  transcriptId: string
  sections: readonly HostTranscriptSection[]
  nextCursor?: string | null
  hasMore: boolean
}

export interface HostTranscriptSearchRequest {
  transcriptId: string
  query: string
  cursor?: string | null
  limit?: number
}

export interface HostTranscriptSearchPage {
  transcriptId: string
  query: string
  sections: readonly HostTranscriptSection[]
  nextCursor?: string | null
  hasMore: boolean
}

export interface HostTranscriptRange {
  startUs: number
  endUs: number
  text?: string
}

export type HostTranscriptCommandAction = 'cut' | 'captions' | 'ripple_cut' | 'caption'

export interface HostTranscriptCommandPreviewRequest {
  transcriptId: string
  assetId: string
  sourceAssetHash: string
  operationId: string
  idempotencyKey: string
  baseRevision: number
  action: HostTranscriptCommandAction
  timestampCapability: 'section' | 'word' | 'frame'
  sectionIds?: readonly string[]
  ranges?: readonly HostTranscriptRange[]
  captionTrackId?: string
  captionTrackName?: string
  captionLanguage?: string | null
  preconditions?: readonly object[]
}

export interface HostTranscriptCommandPreview {
  status: 'preview' | 'replayed'
  receiptId: string
  transcriptId: string
  assetId: string
  sourceAssetHash: string
  timestampCapability: 'section'
  timelineId: string
  operationId: string
  idempotencyKey: string
  baseRevision: number
  commandBatch: EditCommandBatch
  preview: Readonly<{
    action?: string
    sectionCount?: number
    captionCount?: number
    willMutateTimeline: false
    [key: string]: unknown
  }>
}

export interface EditorTranscriptPort {
  getStatus(): Promise<HostTranscriptStatusReceipt | null> | HostTranscriptStatusReceipt | null
  requestTranscription?(input: {
    assetId: string
    language?: string
  }): Promise<HostTranscriptStatusReceipt> | HostTranscriptStatusReceipt
  getSections(
    request: HostTranscriptSectionsRequest,
  ): Promise<HostTranscriptSectionsPage> | HostTranscriptSectionsPage
  search?(
    request: HostTranscriptSearchRequest,
  ): Promise<HostTranscriptSearchPage> | HostTranscriptSearchPage
  previewCommands(
    request: HostTranscriptCommandPreviewRequest,
  ): Promise<HostTranscriptCommandPreview> | HostTranscriptCommandPreview
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

export declare const HOST_SHORTCUTS_SCHEMA: 'freecut-host-shortcuts'
export declare const HOST_SHORTCUTS_VERSION: 1

export interface HostShortcutSettings {
  schema: typeof HOST_SHORTCUTS_SCHEMA
  version: typeof HOST_SHORTCUTS_VERSION
  overrides: HotkeyOverrideMap
}

export interface EditorShortcutPort {
  getSettings(): Promise<HostShortcutSettings> | HostShortcutSettings
  setSettings(settings: HostShortcutSettings): Promise<void> | void
  subscribe?(listener: (settings: HostShortcutSettings) => void): () => void
}

export declare function createHostShortcutSettings(
  overrides?: HotkeyOverrideMap,
): HostShortcutSettings

export interface EditorHost {
  readonly capabilities: EditorCapabilityMap
  load(): Promise<EmbeddedEditorSnapshot> | EmbeddedEditorSnapshot
  resolveMedia(
    locator: MediaLocator,
  ): Promise<ResolvedMediaLocator | null> | ResolvedMediaLocator | null
  submitEdit(batch: EditCommandBatch): Promise<HostEditResult> | HostEditResult
  subscribe?(listener: (snapshot: EmbeddedEditorSnapshot) => void): () => void
  shortcuts?: EditorShortcutPort
  transcript?: EditorTranscriptPort
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
  timeline?: HostTimelineEditPort
}

export interface HostTimelineEditPort {
  requestRippleDelete(itemIds: readonly string[]): Promise<void> | void
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
  'ripple_delete',
  'add_track',
  'update_track',
  'add_caption_track',
  'remove_caption_track',
  'update_caption_track',
  'upsert_caption_cues',
  'remove_caption_cues',
  'set_caption_style',
]
export declare function capabilityForCommand(command: string): EditorCapability | null
export declare function isHostCapabilityEnabled(
  capabilities: EditorCapabilityMap,
  capability: EditorCapability,
): boolean
export declare function createLocalEditorHost(options: LocalEditorHostOptions): EditorHost
