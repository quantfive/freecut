import { isStableIdentifier, validateCommandBatch, validateTimelineState } from './contract'
import type {
  EditApplyResult,
  EditCommandBatch,
  Precondition,
  TimelineItem,
  TimelineState,
  VideoCommandError,
} from './contract'
import { EditEngineError, controlledEditEngine } from './edit-engine'
import type {
  CodePressHostAdapters,
  ControlledEditEngine,
  ControlledEditorDocument,
  ControlledEditorPort,
  ControlledRenderer,
  RenderedFrame,
} from './interfaces'
import { FrameTimingError, assertFrameAligned } from './timing'

interface StoredOperation {
  payload: string
  result: Exclude<EditApplyResult, { status: 'rejected' }>
}

export interface CodePressCommandAdapterOptions {
  document: ControlledEditorDocument
  editor?: ControlledEditorPort
  renderer?: ControlledRenderer
  hosts?: CodePressHostAdapters
  editEngine?: ControlledEditEngine
}

export interface AdapterSnapshot {
  document: ControlledEditorDocument
  revision: number
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function copyResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function emptyActual(): Record<string, string | number | boolean | null> {
  return {}
}

function error(
  code: VideoCommandError['code'],
  message: string,
  details: VideoCommandError['details'],
  extras: Pick<VideoCommandError, 'operation_id' | 'command_id'> = {},
): VideoCommandError {
  const retryable = code === 'revision_conflict' || code === 'operation_in_progress'
  return { code, message, retryable, details, ...extras }
}

function requestString(value: unknown, fallback: string): string {
  return typeof value === 'string' && isStableIdentifier(value) ? value : fallback
}

function rejected(input: unknown, commandError: VideoCommandError): EditApplyResult {
  const candidate = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    status: 'rejected',
    timeline_id: requestString(candidate.timeline_id, 'unknown-timeline'),
    operation_id: requestString(candidate.operation_id, 'invalid-operation'),
    idempotency_key: requestString(candidate.idempotency_key, 'invalid-idempotency'),
    base_revision:
      typeof candidate.base_revision === 'number' &&
      Number.isSafeInteger(candidate.base_revision) &&
      candidate.base_revision >= 0
        ? candidate.base_revision
        : 0,
    error: commandError,
  }
}

function itemId(item: TimelineItem): string {
  return item.item_type === 'caption_cue' ? item.cue_id : item.item_id
}

function findItem(timeline: TimelineState, id: string): TimelineItem | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((candidate) => itemId(candidate) === id)
    if (item) return item
  }
  return undefined
}

function actualForPrecondition(
  timeline: TimelineState,
  precondition: Precondition,
): Record<string, string | number | boolean | null> {
  switch (precondition.type) {
    case 'track_exists':
    case 'track_absent': {
      const track = timeline.tracks.find(
        (candidate) => candidate.track_id === precondition.track_id,
      )
      return { exists: Boolean(track), track_id: track?.track_id ?? null }
    }
    case 'item_exists':
    case 'item_absent': {
      const item = findItem(timeline, precondition.item_id)
      return { exists: Boolean(item), item_id: item ? itemId(item) : null }
    }
    case 'item_at': {
      const item = findItem(timeline, precondition.item_id)
      if (!item)
        return {
          exists: false,
          item_id: null,
          track_id: null,
          timeline_start_us: null,
          timeline_end_us: null,
        }
      return item.item_type === 'caption_cue'
        ? {
            exists: true,
            item_id: item.cue_id,
            track_id: item.track_id,
            timeline_start_us: item.start_us,
            timeline_end_us: item.end_us,
          }
        : {
            exists: true,
            item_id: item.item_id,
            track_id: item.track_id,
            timeline_start_us: item.timeline_start_us,
            timeline_end_us: item.timeline_end_us,
          }
    }
    case 'media_content_hash': {
      const media = timeline.media.find((candidate) => candidate.media_id === precondition.media_id)
      return {
        exists: Boolean(media),
        media_id: media?.media_id ?? null,
        content_hash: media?.content_hash ?? null,
      }
    }
    case 'caption_cue_at': {
      const item = findItem(timeline, precondition.cue_id)
      if (!item || item.item_type !== 'caption_cue')
        return {
          exists: false,
          cue_id: null,
          track_id: null,
          start_us: null,
          end_us: null,
          text: null,
        }
      return {
        exists: true,
        cue_id: item.cue_id,
        track_id: item.track_id,
        start_us: item.start_us,
        end_us: item.end_us,
        text: item.text,
      }
    }
  }
}

function preconditionMatches(timeline: TimelineState, precondition: Precondition): boolean {
  const actual = actualForPrecondition(timeline, precondition)
  switch (precondition.type) {
    case 'track_exists':
      return actual.exists === true
    case 'track_absent':
      return actual.exists === false
    case 'item_exists':
      return actual.exists === true
    case 'item_absent':
      return actual.exists === false
    case 'item_at':
      return (
        actual.exists === true &&
        actual.item_id === precondition.item_id &&
        actual.track_id === precondition.track_id &&
        actual.timeline_start_us === precondition.timeline_start_us &&
        actual.timeline_end_us === precondition.timeline_end_us
      )
    case 'media_content_hash':
      return actual.content_hash === precondition.content_hash
    case 'caption_cue_at':
      return (
        actual.exists === true &&
        actual.cue_id === precondition.cue_id &&
        actual.track_id === precondition.track_id &&
        actual.start_us === precondition.start_us &&
        actual.end_us === precondition.end_us &&
        actual.text === precondition.text
      )
  }
}

function validateCurrentTimeline(timeline: TimelineState): VideoCommandError | null {
  const result = validateTimelineState(timeline)
  return result.ok
    ? null
    : (result.errors[0] ??
        error('invalid_timeline', 'Timeline is invalid', {
          kind: 'invalid_timeline',
          path: 'timeline',
          reason: 'validation failed',
        }))
}

/**
 * CodePress command adapter. It owns neither durable persistence nor media
 * resolution; it atomically translates a validated batch through the pure
 * edit engine and publishes the resulting controlled document to its host.
 */
export class CodePressCommandAdapter implements ControlledEditorPort {
  private document: ControlledEditorDocument
  private readonly renderer?: ControlledRenderer
  private readonly hosts: CodePressHostAdapters
  private readonly editEngine: ControlledEditEngine
  private readonly operations = new Map<string, StoredOperation>()
  private readonly listeners = new Set<(document: ControlledEditorDocument) => void>()
  private readonly externalEditor?: ControlledEditorPort

  constructor(options: CodePressCommandAdapterOptions) {
    const timelineError = validateCurrentTimeline(options.document.timeline)
    if (timelineError) throw new Error(timelineError.message)
    assertFrameAligned(options.document.timeline.duration_us, options.document.fps)
    this.document = copyResult(options.document)
    this.renderer = options.renderer
    this.hosts = options.hosts ?? {}
    this.editEngine = options.editEngine ?? controlledEditEngine
    this.externalEditor = options.editor
  }

  getDocument(): ControlledEditorDocument {
    if (this.externalEditor) return copyResult(this.externalEditor.getDocument())
    return copyResult(this.document)
  }

  replaceDocument(document: ControlledEditorDocument): void {
    const timelineError = validateCurrentTimeline(document.timeline)
    if (timelineError) throw new Error(timelineError.message)
    assertFrameAligned(document.timeline.duration_us, document.fps)
    this.document = copyResult(document)
    this.externalEditor?.replaceDocument(copyResult(document))
    this.notify()
  }

  subscribe(listener: (document: ControlledEditorDocument) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): AdapterSnapshot {
    const document = this.getDocument()
    return { document, revision: document.timeline.revision }
  }

  /** Apply one canonical PR1 command batch synchronously and atomically. */
  apply(input: unknown): EditApplyResult {
    const validRequest = validateCommandBatch(input)
    if (!validRequest.ok) {
      const first =
        validRequest.errors[0] ??
        error('invalid_request', 'Request is invalid', {
          kind: 'invalid_request',
          path: 'request',
          reason: 'validation failed',
        })
      return rejected(input, first)
    }
    const batch: EditCommandBatch = validRequest.value
    const current = this.getDocument()
    const timelineError = validateCurrentTimeline(current.timeline)
    if (timelineError) return rejected(batch, timelineError)
    if (batch.timeline_id !== current.timeline.timeline_id) {
      return rejected(
        batch,
        error(
          'unknown_timeline',
          `Timeline "${batch.timeline_id}" is not loaded`,
          { kind: 'resource', resource: 'timeline', id: batch.timeline_id },
          { operation_id: batch.operation_id },
        ),
      )
    }

    const payload = stableSerialize(batch)
    const prior = this.operations.get(batch.idempotency_key)
    if (prior) {
      if (prior.payload !== payload) {
        return rejected(
          batch,
          error(
            'idempotency_conflict',
            'The idempotency key was already used for a different operation.',
            {
              kind: 'idempotency_conflict',
              idempotency_key: batch.idempotency_key,
              original_operation_id: prior.result.operation_id,
            },
            { operation_id: batch.operation_id },
          ),
        )
      }
      const replayed: Exclude<EditApplyResult, { status: 'rejected' }> = {
        ...copyResult(prior.result),
        status: 'replayed',
        replayed_operation_id: prior.result.operation_id,
      }
      return copyResult(replayed)
    }

    if (batch.base_revision !== current.timeline.revision) {
      return rejected(
        batch,
        error(
          'revision_conflict',
          'The timeline changed after this operation was prepared.',
          {
            kind: 'revision_conflict',
            base_revision: batch.base_revision,
            current_revision: current.timeline.revision,
            rebase: {
              status: 'required',
              automatic: false,
              strategy: 'refresh_then_resubmit',
              retry_with_revision: current.timeline.revision,
            },
          },
          { operation_id: batch.operation_id },
        ),
      )
    }

    for (const [index, precondition] of batch.preconditions.entries()) {
      if (!preconditionMatches(current.timeline, precondition)) {
        return rejected(
          batch,
          error(
            'precondition_failed',
            `Precondition ${index} failed.`,
            {
              kind: 'precondition_failed',
              precondition_index: index,
              precondition,
              actual: actualForPrecondition(current.timeline, precondition) ?? emptyActual(),
            },
            { operation_id: batch.operation_id },
          ),
        )
      }
    }

    try {
      const engineResult = this.editEngine.apply(current.timeline, batch.commands, {
        fps: current.fps,
      })
      const nextTimeline: TimelineState = {
        ...engineResult.timeline,
        revision: current.timeline.revision + 1,
      }
      const nextDocument = { ...current, timeline: nextTimeline }
      const result: Exclude<EditApplyResult, { status: 'rejected' }> = {
        status: 'applied',
        timeline_id: batch.timeline_id,
        operation_id: batch.operation_id,
        idempotency_key: batch.idempotency_key,
        base_revision: batch.base_revision,
        previous_revision: current.timeline.revision,
        resulting_revision: nextTimeline.revision,
        timeline: nextTimeline,
        commands: engineResult.commands,
        rebase: { status: 'not_attempted', automatic: false },
      }
      this.document = copyResult(nextDocument)
      this.externalEditor?.replaceDocument(copyResult(nextDocument))
      this.operations.set(batch.idempotency_key, { payload, result: copyResult(result) })
      this.notify()
      void this.hosts.telemetryClient?.emit({
        name: 'video.timeline_operation_applied',
        timeline_id: batch.timeline_id,
        operation_id: batch.operation_id,
        revision: nextTimeline.revision,
        attributes: { command_count: batch.commands.length },
      })
      return copyResult(result)
    } catch (caught) {
      const commandError =
        caught instanceof FrameTimingError
          ? error(
              'invalid_request',
              caught.message,
              { kind: 'invalid_request', path: 'commands', reason: 'time must be frame-aligned' },
              { operation_id: batch.operation_id },
            )
          : caught instanceof EditEngineError
            ? error(
                caught.code === 'unknown_track'
                  ? 'unknown_track'
                  : caught.code === 'unknown_item'
                    ? 'unknown_item'
                    : caught.code === 'unknown_media'
                      ? 'unknown_media'
                      : caught.code === 'unsupported_command'
                        ? 'unsupported_command'
                        : 'invalid_request',
                caught.message,
                { kind: 'generic', reason: caught.message },
                {
                  operation_id: batch.operation_id,
                  ...(caught.command_id ? { command_id: caught.command_id } : {}),
                },
              )
            : error(
                'invalid_request',
                caught instanceof Error ? caught.message : String(caught),
                {
                  kind: 'generic',
                  reason: caught instanceof Error ? caught.message : String(caught),
                },
                { operation_id: batch.operation_id },
              )
      return rejected(batch, commandError)
    }
  }

  async renderFrame(time_us: number): Promise<RenderedFrame> {
    if (!this.renderer) throw new Error('No controlled renderer is attached')
    const document = this.getDocument()
    const frame = assertFrameAligned(time_us, document.fps)
    return this.renderer.renderFrame({ document, frame, time_us })
  }

  private notify(): void {
    const document = this.getDocument()
    for (const listener of this.listeners) listener(document)
  }
}

export function createCodePressCommandAdapter(
  options: CodePressCommandAdapterOptions,
): CodePressCommandAdapter {
  return new CodePressCommandAdapter(options)
}
