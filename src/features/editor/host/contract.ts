import type {
  EditApplyResult,
  EditCommandBatch,
  EditCommand,
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
