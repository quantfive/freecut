import type {
  EditApplyResult,
  EditCommandBatch,
  EditCommand,
  Microseconds,
  Precondition,
  TimelineRevision,
} from '@/features/editor/codepress/contract'
import type { FreeCutFrameDocument } from '@/features/editor/codepress/document'

/**
 * The browser surface is deliberately a port.  It knows how to render and
 * translate a bounded editor command, but it does not know how the host
 * authenticates, stores, or transports that command.
 */
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

export const DEFAULT_HOST_CAPABILITIES: EditorCapabilityMap = {
  'project.navigate': false,
  'project.save': false,
  'media.resolve': true,
  'media.import': false,
  'media.delete': false,
  'media.proxy': false,
  'media.transcription': false,
  'media.relink': false,
  'timeline.add': true,
  'timeline.move': true,
  'timeline.trim': true,
  'timeline.split': true,
  'timeline.remove': true,
  'timeline.track': true,
  'timeline.caption': true,
  'workspace.edit': true,
  'workspace.color': false,
  'workspace.motion': false,
  'export.video': false,
  'export.bundle': false,
  'render.queue': false,
}

export type HostMediaKind = 'video' | 'audio' | 'image' | 'lottie'

/** Opaque control-plane reference.  It never contains a path, URL, or bytes. */
export interface MediaLocator {
  mediaId: string
  kind: HostMediaKind
  variant?: 'source' | 'proxy' | 'thumbnail'
}

/** Runtime-only result of resolving a locator.  It must never enter a snapshot. */
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

/** Asset metadata is descriptive and path-free; playback is a separate port. */
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

/** Maximum section/range selection accepted by the PR9B transcript adapter. */
export const MAX_TRANSCRIPT_SELECTIONS = 64
/** The backend exposes at most this many sections per bounded page. */
export const MAX_TRANSCRIPT_SECTION_PAGE_SIZE = 50
/** Maximum UTF-8 bytes accepted for one bounded transcript section. */
export const MAX_TRANSCRIPT_SECTION_TEXT_BYTES = 4_000
/** Maximum UTF-8 bytes accepted for one generated transcript command. */
export const MAX_TRANSCRIPT_COMMAND_TEXT_BYTES = 64 * 1024
/** Maximum source duration representable by a transcript command selection. */
export const MAX_TRANSCRIPT_DURATION_US = 3_600_000_000
/** Maximum cursor/query payload size accepted by the browser port. */
export const MAX_TRANSCRIPT_CURSOR_LENGTH = 256
export const MAX_TRANSCRIPT_QUERY_LENGTH = 256

export type HostTranscriptStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'stale'
  | 'purged'

/** Safe, structured transcript failure information from the application host. */
export interface HostTranscriptError {
  code: string
  message: string
  retryable: boolean
  details?: Readonly<Record<string, unknown>>
}

/**
 * Compact source-bound transcript receipt.  The host owns authorization and
 * transport; FreeCut receives only opaque IDs, a source hash, status, and
 * bounded recovery information.
 */
export interface HostTranscriptStatusReceipt {
  transcriptId: string
  assetId: string | null
  sourceAssetHash: string
  status: HostTranscriptStatus
  language?: string | null
  durationUs: Microseconds | null
  sectionCount: number
  error?: HostTranscriptError | null
}

/** One bounded, source-addressable transcript section. */
export interface HostTranscriptSection {
  id: string
  transcriptId: string
  ordinal: number
  startUs: Microseconds
  endUs: Microseconds
  text: string
  speaker?: string | null
}

export interface HostTranscriptSectionsRequest {
  transcriptId: string
  cursor?: string | null
  limit?: number
  startUs?: Microseconds
  endUs?: Microseconds
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

/** A positive integer-microsecond source range selected for preview. */
export interface HostTranscriptRange {
  startUs: Microseconds
  endUs: Microseconds
  text?: string
}

export type HostTranscriptCommandAction = 'cut' | 'captions' | 'ripple_cut' | 'caption'

/** PR9B request shape.  It previews only; it never mutates the host timeline. */
export interface HostTranscriptCommandPreviewRequest {
  transcriptId: string
  assetId: string
  sourceAssetHash: string
  operationId: string
  idempotencyKey: string
  baseRevision: TimelineRevision
  action: HostTranscriptCommandAction
  timestampCapability: 'section' | 'word' | 'frame'
  sectionIds?: readonly string[]
  ranges?: readonly HostTranscriptRange[]
  captionTrackId?: string
  captionTrackName?: string
  captionLanguage?: string | null
  preconditions?: readonly Precondition[]
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
  baseRevision: TimelineRevision
  commandBatch: EditCommandBatch
  preview: Readonly<{
    action?: string
    sectionCount?: number
    captionCount?: number
    willMutateTimeline: false
    [key: string]: unknown
  }>
}

/**
 * Optional host-backed transcript consumer port.  Implementations may use an
 * authenticated API, desktop bridge, or another application-owned transport;
 * those details never enter the FreeCut surface.
 */
export interface EditorTranscriptPort {
  getStatus(): Promise<HostTranscriptStatusReceipt | null> | HostTranscriptStatusReceipt | null
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
  result: Extract<EditApplyResult, { status: 'applied' | 'replayed' }>
}

export interface HostConflictResult {
  status: 'conflict' | 'rejected'
  snapshot: EmbeddedEditorSnapshot
  result: Extract<EditApplyResult, { status: 'rejected' }>
}

export type HostEditResult = HostAppliedEditResult | HostConflictResult

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
  /**
   * Optional out-of-band authority push.  A host that can revise the timeline
   * without the surface asking (an agent run, a collaborator's edit) delivers
   * the new authoritative snapshot here; the surface adopts it in place
   * instead of being remounted with a fresh `host`.  Returns an unsubscribe
   * the surface calls when it tears the runtime down.
   */
  subscribe?(listener: (snapshot: EmbeddedEditorSnapshot) => void): () => void
  /** Optional application-issued transcript read/preview boundary. */
  transcript?: EditorTranscriptPort
  navigation?: EditorHostNavigation
  notify?(notice: HostNotice): void
}

/** Commands the first host surface can translate without guessing. */
export const SUPPORTED_HOST_COMMANDS = [
  'add_clip',
  'add_text',
  'move_item',
  'trim_item',
  'split_item',
  'remove_item',
  'add_track',
  'update_track',
  'add_caption_track',
  'remove_caption_track',
  'update_caption_track',
  'upsert_caption_cues',
  'remove_caption_cues',
  'set_caption_style',
] as const satisfies readonly EditCommand['type'][]

export function capabilityForCommand(command: EditCommand['type']): EditorCapability | null {
  switch (command) {
    case 'add_clip':
    case 'add_text':
      return 'timeline.add'
    case 'move_item':
      return 'timeline.move'
    case 'trim_item':
      return 'timeline.trim'
    case 'split_item':
      return 'timeline.split'
    case 'remove_item':
      return 'timeline.remove'
    case 'add_track':
      return 'timeline.track'
    case 'update_track':
    case 'add_caption_track':
    case 'remove_caption_track':
    case 'update_caption_track':
    case 'upsert_caption_cues':
    case 'remove_caption_cues':
    case 'set_caption_style':
      return 'timeline.caption'
    default:
      return null
  }
}

export function isHostCapabilityEnabled(
  capabilities: EditorCapabilityMap,
  capability: EditorCapability,
): boolean {
  return capabilities[capability] === true
}

/**
 * Small adapter useful for a standalone host or a later CodePress host.  The
 * adapter only normalizes optional callbacks; it does not introduce storage,
 * HTTP, authentication, or media-byte dependencies.
 */
export type LocalEditorHostOptions = Omit<EditorHost, 'capabilities'> & {
  capabilities?: EditorCapabilityMap
}

export function createLocalEditorHost(options: LocalEditorHostOptions): EditorHost {
  const { capabilities = {}, ...callbacks } = options
  return {
    ...callbacks,
    capabilities,
  }
}
