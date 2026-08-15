import type {
  AppliedCommandResult,
  EditApplyResult,
  EditCommandBatch,
  EditCommand,
  MediaId,
  TimelineState,
  TimelineRevision,
} from './contract'

/** Data the controlled editor owns while it is mounted. It is not persistence. */
export interface ControlledEditorDocument {
  timeline: TimelineState
  fps: number
  width: number
  height: number
  background_color?: string
}

/** The narrow state port a host supplies to a controlled editor surface. */
export interface ControlledEditorPort {
  getDocument(): ControlledEditorDocument
  replaceDocument(document: ControlledEditorDocument): void
  subscribe?(listener: (document: ControlledEditorDocument) => void): () => void
}

export interface EditEngineContext {
  fps: number
}

export interface EditEngineResult {
  timeline: TimelineState
  commands: readonly AppliedCommandResult[]
}

/** Pure, worker-safe application boundary. Implementations must be atomic. */
export interface ControlledEditEngine {
  apply(
    timeline: TimelineState,
    commands: readonly EditCommand[],
    context: EditEngineContext,
  ): EditEngineResult
}

export interface RenderFrameRequest {
  document: ControlledEditorDocument
  frame: number
  time_us: number
  width?: number
  height?: number
}

export interface RenderedFrame {
  frame: number
  time_us: number
  width: number
  height: number
  /** Renderer-specific pixels/image handle; never part of a command result. */
  payload: unknown
}

/** Rendering is deliberately a port: no renderer or media URL is in the command contract. */
export interface ControlledRenderer {
  renderFrame(request: RenderFrameRequest): Promise<RenderedFrame> | RenderedFrame
}

export interface ProjectRevision {
  timeline: TimelineState
  revision: TimelineRevision
}

/** CodePress-owned persistence boundary; FreeCut never writes the project store directly. */
export interface ProjectStore {
  loadCurrentRevision(timelineId: string): Promise<ProjectRevision> | ProjectRevision
  submitOperation?(batch: EditCommandBatch): Promise<EditApplyResult> | EditApplyResult
  subscribe?(timelineId: string, listener: (revision: ProjectRevision) => void): () => void
}

export interface ResolvedAsset {
  media_id: MediaId
  kind: 'local' | 'cloud'
  /** Short-lived host locator; never copied into TimelineState. */
  source: string
}

export interface AssetResolver {
  resolve(mediaId: MediaId): Promise<ResolvedAsset> | ResolvedAsset
}

export interface UploadClient {
  upload(mediaId: MediaId): Promise<{ media_id: MediaId; status: 'uploaded' | 'already_available' }>
}

export interface MediaJobClient {
  request(input: {
    job_type: import('./contract').VideoJobType
    media_id?: MediaId
    timeline_revision?: TimelineRevision
    options?: Readonly<Record<string, string | number | boolean | null>>
  }): Promise<{ job_id: string }> | { job_id: string }
}

export interface RenderJobClient {
  request(input: {
    kind: 'preview' | 'export'
    timeline_id: string
    revision: TimelineRevision
    options?: Readonly<Record<string, string | number | boolean | null>>
  }): Promise<{ job_id: string }> | { job_id: string }
  cancel?(jobId: string): Promise<void> | void
}

export interface PresenceClient {
  getStatus():
    | Promise<{ available: boolean; label?: string }>
    | { available: boolean; label?: string }
}

export interface TelemetryClient {
  emit(event: {
    name: string
    timeline_id?: string
    operation_id?: string
    revision?: TimelineRevision
    attributes?: Readonly<Record<string, string | number | boolean | null>>
  }): Promise<void> | void
}

export interface CodePressHostAdapters {
  projectStore?: ProjectStore
  assetResolver?: AssetResolver
  uploadClient?: UploadClient
  mediaJobClient?: MediaJobClient
  renderJobClient?: RenderJobClient
  presenceClient?: PresenceClient
  telemetryClient?: TelemetryClient
}
