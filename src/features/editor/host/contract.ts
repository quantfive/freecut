import type { ComponentType } from 'react'
import type {
  EditApplyResult,
  EditCommandBatch,
  EditCommand,
  Microseconds,
  Precondition,
  TimelineRevision,
} from '@/features/editor/codepress/contract'
import type { FreeCutFrameDocument } from '@/features/editor/codepress/document'
import type { EditorSidebarTab } from '@/config/editor-workspaces'

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

/**
 * One predicate the local-change classifier evaluates.  A predicate is
 * reported when it is the reason a change could not be classified:
 *
 * - `metadata` — a non-positional field differs
 * - `transform` — the normalized transforms differ
 * - `sourceRange` — both sides state a source bound and the bounds differ
 * - `track` — the item changed track, which rules out a trim
 * - `timelinePosition` — the timeline position and duration are unchanged,
 *   which rules out a move
 */
export type HostEditPredicate =
  | 'metadata'
  | 'transform'
  | 'sourceRange'
  | 'track'
  | 'timelinePosition'

/**
 * Value-free explanation of a rejected local change.  It carries which
 * classifier predicates failed and which field *names* differed so a rejection
 * is diagnosable from a screenshot or a host log.  It deliberately never
 * carries field values, media locators, or serialized items.
 */
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
  /**
   * Optional host-owned transcription start.  The host performs the work and
   * returns the first receipt; the surface only polls `getStatus` afterwards.
   * Gated by the `media.transcription` capability.
   */
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

/**
 * A host-owned module registered into the editor's left sidebar rail.  The
 * surface namespaces the tab id to `host:<id>` internally so host tabs cannot
 * collide with the built-in rail categories, and renders `Panel` in the
 * sidebar panel area.  Icons and panels cross the package boundary as React
 * components; react/react-dom are peer dependencies, so the host and the
 * surface share one React copy.
 */
export interface EditorSidebarModule {
  /** Host-scoped identifier; namespaced to `host:<id>` internally. */
  id: string
  /** Rail tooltip and panel header label.  Host-owned, already localized. */
  label: string
  /** Lucide-compatible rail icon. */
  icon: ComponentType<{ className?: string }>
  /**
   * Rendered in the sidebar panel area.  Mounted on first activation and kept
   * mounted across tab switches so in-flight host work survives.
   */
  Panel: ComponentType<EditorSidebarModulePanelProps>
}

/**
 * Props a host module panel receives.  A panel that only cares about `active`
 * can keep destructuring just that — the extra fields widen the props without
 * breaking an existing `({ active }) => …` component.
 */
export interface EditorSidebarModulePanelProps {
  /** Whether this module's tab is the selected one. */
  active: boolean
  /**
   * Whether the sidebar panel area is collapsed.  A latched panel keeps
   * rendering while collapsed so its work survives; use this to pause
   * animation or defer layout measurement rather than to unmount.
   */
  collapsed: boolean
  /** Current sidebar panel width in px, so a panel can adapt to a resize. */
  width: number
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
  /** Optional host-owned modules added to the editor's left sidebar rail. */
  sidebarModules?: readonly EditorSidebarModule[]
  /**
   * Optional explicit rail: the exact tabs to show, in the exact order, as
   * built-in ids (`'media'`, `'text'`, `'transcript'`) and registered module
   * ids (`` `host:${id}` ``).  Anything omitted is hidden, so this is how a
   * host both reorders the rail and suppresses built-ins it does not want.
   *
   * Capability gating still runs first — a rail cannot surface a tab the
   * host's own capabilities deny — and ids that match nothing are dropped, as
   * are repeats after the first.  Omit the field for the default rail
   * (capability-gated built-ins, then modules in registration order).  A rail
   * that matches nothing at all falls back to the default rather than leaving
   * the editor with no navigation.
   */
  sidebarRail?: readonly EditorSidebarTab[]
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
  'ripple_delete',
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
    case 'ripple_delete':
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
