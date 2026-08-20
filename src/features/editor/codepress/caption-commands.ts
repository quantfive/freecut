import {
  VIDEO_COMMAND_CONTRACT_VERSION,
  type EditApplyResult,
  type EditCommandBatch,
  type Precondition,
  type TimelineRevision,
} from './contract'
import type { AdapterSnapshot } from './adapter'
import type { ControlledEditorDocument } from './interfaces'
import type { FreeCutFrameCaptionCue } from './document'
import {
  translateFrameCaptionCommandToCommand,
  type CaptionCommand,
  type FrameCaptionCommand,
  type FrameCaptionCue,
} from './translation'
import { framesToMicroseconds, type FrameRateLike } from './timing'

export interface CaptionDocumentPort {
  getSnapshot(): AdapterSnapshot
  subscribe(listener: (document: ControlledEditorDocument) => void): () => void
}

export interface CaptionCommandPort extends CaptionDocumentPort {
  apply(input: unknown): EditApplyResult
}

export type CaptionCommandSubmitter = (
  batch: EditCommandBatch,
) => EditApplyResult | Promise<EditApplyResult>

export interface CaptionBatchOptions {
  operationId?: string
  idempotencyKey?: string
  baseRevision?: TimelineRevision
  preconditions?: readonly Precondition[]
}

export function makeCaptionOperationId(prefix = 'caption-operation'): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}-${suffix}`
}

export function frameCueToCommandCue(cue: FreeCutFrameCaptionCue): FrameCaptionCue {
  return {
    item_type: 'caption_cue',
    cue_id: cue.id,
    track_id: cue.trackId,
    start_frame: cue.from,
    end_frame: cue.from + cue.durationInFrames,
    text: cue.text,
    ...(cue.speaker !== undefined ? { speaker: cue.speaker } : {}),
    ...(cue.style !== undefined ? { style: { ...cue.style } } : {}),
  }
}

export function captionCuePrecondition(
  cue: FrameCaptionCue | FreeCutFrameCaptionCue,
  fps: FrameRateLike,
): Precondition {
  const normalized = 'cue_id' in cue ? cue : frameCueToCommandCue(cue)
  return {
    type: 'caption_cue_at',
    track_id: normalized.track_id,
    cue_id: normalized.cue_id,
    start_us: framesToMicroseconds(normalized.start_frame, fps),
    end_us: framesToMicroseconds(normalized.end_frame, fps),
    text: normalized.text,
  }
}

export function createCaptionCommandBatch(
  adapter: CaptionDocumentPort,
  frameCommands: readonly FrameCaptionCommand[],
  fps: FrameRateLike,
  options: CaptionBatchOptions = {},
): EditCommandBatch {
  const snapshot = adapter.getSnapshot()
  const operationId = options.operationId ?? makeCaptionOperationId()
  return {
    contract_version: VIDEO_COMMAND_CONTRACT_VERSION,
    timeline_id: snapshot.document.timeline.timeline_id,
    operation_id: operationId,
    idempotency_key: options.idempotencyKey ?? operationId,
    base_revision: options.baseRevision ?? snapshot.revision,
    preconditions: options.preconditions ?? [],
    commands: frameCommands.map((command) =>
      translateFrameCaptionCommandToCommand(command, fps),
    ) as readonly CaptionCommand[],
  }
}

export function applyCaptionCommands(
  adapter: CaptionCommandPort,
  frameCommands: readonly FrameCaptionCommand[],
  fps: FrameRateLike,
  options: CaptionBatchOptions = {},
): EditApplyResult {
  return adapter.apply(createCaptionCommandBatch(adapter, frameCommands, fps, options))
}

export function isCaptionApplySuccess(
  result: EditApplyResult,
): result is Extract<EditApplyResult, { status: 'applied' | 'replayed' }> {
  return result.status === 'applied' || result.status === 'replayed'
}
