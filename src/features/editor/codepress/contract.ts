/**
 * The FreeCut-side view of the CodePress video command contract.
 *
 * CodePress owns the wire package.  This file intentionally mirrors its
 * language-neutral field names instead of importing FreeCut's persisted
 * project schema or the development-only headless API.  Keeping the boundary
 * here makes the adapter usable by a browser editor, a worker, and tests
 * without giving any of those callers a filesystem or HTTP seam.
 */

export const VIDEO_COMMAND_CONTRACT_VERSION = 1 as const
export const VIDEO_TIMELINE_SCHEMA_VERSION = 1 as const

export const MAX_COMMANDS_PER_OPERATION = 64
export const MAX_PRECONDITIONS_PER_OPERATION = 128
export const MAX_CAPTION_CUES_PER_COMMAND = 512
export const MAX_TRACKS_PER_TIMELINE = 128
export const MAX_ITEMS_PER_TRACK = 4096
export const MAX_ID_LENGTH = 128
export const MAX_TEXT_LENGTH = 32_000

export type Brand<T, Name extends string> = T & { readonly __brand: Name }
export type TimelineId = string
export type TimelineItemId = string
export type TrackId = string
export type MediaId = string
export type AssetId = MediaId
export type DeviceId = string
export type MediaRootId = string
export type LocalFileId = string
export type CloudObjectId = string
export type ContentHash = string
export type OperationId = string
export type IdempotencyKey = string
export type CommandId = string
export type CaptionCueId = TimelineItemId
export type ActorId = string
export type Microseconds = number
export type TimelineRevision = number

export const MEDIA_KINDS = ['video', 'audio', 'image'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export interface LocalMediaReference {
  device_id: DeviceId
  root_id: MediaRootId
  file_id: LocalFileId
  root_generation: number
}

export interface CloudMediaReference {
  object_id: CloudObjectId
}

export type MediaAvailability =
  | { mode: 'local'; local: LocalMediaReference; cloud?: never }
  | { mode: 'cloud'; local?: never; cloud: CloudMediaReference }
  | { mode: 'hybrid'; local: LocalMediaReference; cloud: CloudMediaReference }

export interface MediaReference {
  media_id: MediaId
  media_kind: MediaKind
  content_hash: ContentHash
  duration_us: Microseconds | null
  availability: MediaAvailability
}
export type MediaRef = MediaReference

export interface Transform {
  position_x: number
  position_y: number
  scale_x: number
  scale_y: number
  rotation_degrees: number
  anchor_x: number
  anchor_y: number
}

export interface CaptionStyle {
  font_family?: string
  font_size?: number
  color?: string
  background_color?: string
  background_opacity?: number
  alignment?: 'left' | 'center' | 'right'
}

export interface TextStyle {
  font_family?: string
  font_size?: number
  color?: string
  alignment?: 'left' | 'center' | 'right'
}

export interface Transition {
  transition_type: 'crossfade' | 'dip_to_black' | 'dip_to_white' | 'wipe'
  duration_us: Microseconds
}

export interface Effect {
  effect_type: 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'saturation'
  amount: number
}

export interface Keyframe {
  property:
    | 'position_x'
    | 'position_y'
    | 'scale_x'
    | 'scale_y'
    | 'rotation_degrees'
    | 'opacity'
    | 'volume'
  time_us: Microseconds
  value: number
  interpolation: 'step' | 'linear' | 'bezier'
}

export interface ClipItem {
  item_type: 'clip'
  item_id: TimelineItemId
  track_id: TrackId
  media_id: MediaId
  media_kind: MediaKind
  timeline_start_us: Microseconds
  timeline_end_us: Microseconds
  source_start_us: Microseconds
  source_end_us: Microseconds
  transform?: Transform
  opacity?: number
  volume?: number
  speed?: number
  fade_in_us?: Microseconds
  fade_out_us?: Microseconds
  transition_in?: Transition | null
  transition_out?: Transition | null
  effects?: readonly Effect[]
  keyframes?: readonly Keyframe[]
}

export interface TextItem {
  item_type: 'text'
  item_id: TimelineItemId
  track_id: TrackId
  timeline_start_us: Microseconds
  timeline_end_us: Microseconds
  text: string
  style?: TextStyle
  transform?: Transform
  opacity?: number
  keyframes?: readonly Keyframe[]
}

export interface CaptionCue {
  item_type: 'caption_cue'
  cue_id: CaptionCueId
  track_id: TrackId
  start_us: Microseconds
  end_us: Microseconds
  text: string
  speaker?: string | null
  style?: CaptionStyle
}

export type TimelineItem = ClipItem | TextItem | CaptionCue
export type TimelineItemInput = ClipItem | TextItem
export const TRACK_KINDS = ['video', 'audio', 'overlay', 'caption'] as const
export type TrackKind = (typeof TRACK_KINDS)[number]

export interface TimelineTrack {
  track_id: TrackId
  kind: TrackKind
  name: string
  language?: string
  locked: boolean
  muted: boolean
  /** Optional FreeCut-side extension for caption-track defaults. */
  default_style?: CaptionStyle | null
  items: readonly TimelineItem[]
}

export interface TimelineState {
  contract_version: typeof VIDEO_COMMAND_CONTRACT_VERSION
  schema_version: typeof VIDEO_TIMELINE_SCHEMA_VERSION
  timeline_id: TimelineId
  revision: TimelineRevision
  duration_us: Microseconds
  media: readonly MediaReference[]
  tracks: readonly TimelineTrack[]
}

export interface AddClipCommand {
  command_id: CommandId
  type: 'add_clip'
  track_id: TrackId
  item: ClipItem
  index?: number
}
export interface AddTextCommand {
  command_id: CommandId
  type: 'add_text'
  track_id: TrackId
  item: TextItem
  index?: number
}
export interface DuplicateItemCommand {
  command_id: CommandId
  type: 'duplicate_item'
  item_id: TimelineItemId
  new_item_id: TimelineItemId
  to_track_id: TrackId
  timeline_start_us?: Microseconds
  index?: number
}
export interface RemoveItemCommand {
  command_id: CommandId
  type: 'remove_item'
  item_id: TimelineItemId
}
export interface MoveItemCommand {
  command_id: CommandId
  type: 'move_item'
  item_id: TimelineItemId
  to_track_id: TrackId
  timeline_start_us: Microseconds
  index: number
}
export interface TrimItemCommand {
  command_id: CommandId
  type: 'trim_item'
  item_id: TimelineItemId
  edge: 'start' | 'end'
  timeline_us: Microseconds
  source_us: Microseconds
}
export interface SplitItemCommand {
  command_id: CommandId
  type: 'split_item'
  item_id: TimelineItemId
  at_timeline_us: Microseconds
  at_source_us: Microseconds
  left_item_id: TimelineItemId
  right_item_id: TimelineItemId
}
export interface RippleDeleteCommand {
  command_id: CommandId
  type: 'ripple_delete'
  start_us: Microseconds
  end_us: Microseconds
  track_ids: readonly TrackId[] | null
}
export interface AddTrackCommand {
  command_id: CommandId
  type: 'add_track'
  track: Omit<TimelineTrack, 'items'> & { items?: readonly [] }
  index: number
}
export interface RemoveTrackCommand {
  command_id: CommandId
  type: 'remove_track'
  track_id: TrackId
}
export interface MoveTrackCommand {
  command_id: CommandId
  type: 'move_track'
  track_id: TrackId
  to_index: number
}
export interface UpdateTrackCommand {
  command_id: CommandId
  type: 'update_track'
  track_id: TrackId
  name?: string
  language?: string | null
  locked?: boolean
  muted?: boolean
}
export interface AddCaptionTrackCommand {
  command_id: CommandId
  type: 'add_caption_track'
  track_id: TrackId
  name: string
  language: string
  index: number
}
export interface RemoveCaptionTrackCommand {
  command_id: CommandId
  type: 'remove_caption_track'
  track_id: TrackId
}
export interface UpdateCaptionTrackCommand {
  command_id: CommandId
  type: 'update_caption_track'
  track_id: TrackId
  name?: string
  language?: string
  default_style?: CaptionStyle | null
}
export interface UpsertCaptionCuesCommand {
  command_id: CommandId
  type: 'upsert_caption_cues'
  track_id: TrackId
  cues: readonly CaptionCue[]
}
export interface RemoveCaptionCuesCommand {
  command_id: CommandId
  type: 'remove_caption_cues'
  track_id: TrackId
  cue_ids: readonly CaptionCueId[]
}

export interface ItemPropertiesPatch {
  transform?: Transform | null
  opacity?: number
  volume?: number
  speed?: number
  fade_in_us?: Microseconds | null
  fade_out_us?: Microseconds | null
  text?: string
  text_style?: TextStyle | null
  effects?: readonly Effect[]
  keyframes?: readonly Keyframe[]
  transition_in?: Transition | null
  transition_out?: Transition | null
}
export interface SetItemPropertiesCommand {
  command_id: CommandId
  type: 'set_item_properties'
  item_id: TimelineItemId
  properties: ItemPropertiesPatch
}
export interface SetCaptionStyleCommand {
  command_id: CommandId
  type: 'set_caption_style'
  track_id: TrackId
  cue_ids: readonly CaptionCueId[] | null
  style: CaptionStyle
}

export const VIDEO_JOB_TYPES = [
  'inspect',
  'proxy',
  'thumbnail',
  'contact_sheet',
  'waveform',
  'transcribe',
  'analysis',
  'preview',
  'export',
  'cloud_upload',
] as const
export type VideoJobType = (typeof VIDEO_JOB_TYPES)[number]
export interface RequestJobCommand {
  command_id: CommandId
  type: 'request_job'
  job_type: VideoJobType
  media_id?: MediaId
  timeline_revision?: TimelineRevision
  options?: Readonly<Record<string, string | number | boolean | null>>
}

export type EditCommand =
  | AddClipCommand
  | AddTextCommand
  | DuplicateItemCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand
  | SplitItemCommand
  | RippleDeleteCommand
  | AddTrackCommand
  | RemoveTrackCommand
  | MoveTrackCommand
  | UpdateTrackCommand
  | AddCaptionTrackCommand
  | RemoveCaptionTrackCommand
  | UpdateCaptionTrackCommand
  | UpsertCaptionCuesCommand
  | RemoveCaptionCuesCommand
  | SetItemPropertiesCommand
  | SetCaptionStyleCommand
  | RequestJobCommand
export type VideoCommand = EditCommand

export interface EditCommandBatch {
  contract_version: typeof VIDEO_COMMAND_CONTRACT_VERSION
  timeline_id: TimelineId
  operation_id: OperationId
  idempotency_key: IdempotencyKey
  base_revision: TimelineRevision
  preconditions: readonly Precondition[]
  commands: readonly EditCommand[]
}
export type CommandBatch = EditCommandBatch
export type CommandType = EditCommand['type']

export const COMMAND_BATCH_LIMITS = {
  max_commands: MAX_COMMANDS_PER_OPERATION,
  max_preconditions: MAX_PRECONDITIONS_PER_OPERATION,
  max_caption_cues_per_command: MAX_CAPTION_CUES_PER_COMMAND,
} as const

export function commandType(command: EditCommand): CommandType {
  return command.type
}

export function itemIdFromCommand(command: EditCommand): TimelineItemId | null {
  switch (command.type) {
    case 'add_clip':
    case 'add_text':
      return command.item.item_id
    case 'duplicate_item':
      return command.new_item_id
    case 'remove_item':
    case 'move_item':
    case 'trim_item':
    case 'split_item':
    case 'set_item_properties':
      return command.item_id
    case 'upsert_caption_cues':
      return command.cues[0]?.cue_id ?? null
    case 'remove_caption_cues':
      return command.cue_ids[0] ?? null
    case 'set_caption_style':
      return command.cue_ids?.[0] ?? null
    default:
      return null
  }
}

export function isTimelineItemCommand(
  command: EditCommand,
): command is Exclude<
  EditCommand,
  | AddTrackCommand
  | RemoveTrackCommand
  | MoveTrackCommand
  | UpdateTrackCommand
  | AddCaptionTrackCommand
  | RemoveCaptionTrackCommand
  | UpdateCaptionTrackCommand
  | UpsertCaptionCuesCommand
  | RemoveCaptionCuesCommand
  | SetCaptionStyleCommand
  | RequestJobCommand
  | RippleDeleteCommand
> {
  return itemIdFromCommand(command) !== null
}

export type CommandItem = TimelineItem

export interface TrackExistsPrecondition {
  type: 'track_exists'
  track_id: TrackId
}
export interface TrackAbsentPrecondition {
  type: 'track_absent'
  track_id: TrackId
}
export interface ItemExistsPrecondition {
  type: 'item_exists'
  item_id: TimelineItemId
}
export interface ItemAbsentPrecondition {
  type: 'item_absent'
  item_id: TimelineItemId
}
export interface ItemAtPrecondition {
  type: 'item_at'
  item_id: TimelineItemId
  track_id: TrackId
  timeline_start_us: Microseconds
  timeline_end_us: Microseconds
}
export interface MediaContentHashPrecondition {
  type: 'media_content_hash'
  media_id: MediaId
  content_hash: ContentHash
}
export interface CaptionCueAtPrecondition {
  type: 'caption_cue_at'
  track_id: TrackId
  cue_id: TimelineItemId
  start_us: Microseconds
  end_us: Microseconds
  text: string
}
export type Precondition =
  | TrackExistsPrecondition
  | TrackAbsentPrecondition
  | ItemExistsPrecondition
  | ItemAbsentPrecondition
  | ItemAtPrecondition
  | MediaContentHashPrecondition
  | CaptionCueAtPrecondition

export interface CommandEffect {
  created_item_ids: readonly string[]
  updated_item_ids: readonly string[]
  deleted_item_ids: readonly string[]
  moved_item_ids: readonly string[]
  created_track_ids: readonly string[]
  updated_track_ids: readonly string[]
  deleted_track_ids: readonly string[]
  timeline_delta_us: number
}
export interface AppliedCommandResult {
  command_id: CommandId
  command_type: CommandType
  status: 'applied'
  effect: CommandEffect
}
export interface OperationResultMetadata {
  timeline_id: TimelineId
  operation_id: OperationId
  idempotency_key: IdempotencyKey
  base_revision: TimelineRevision
  previous_revision: TimelineRevision
  resulting_revision: TimelineRevision
}
export interface AppliedOperationResult extends OperationResultMetadata {
  status: 'applied'
  timeline: TimelineState
  commands: readonly AppliedCommandResult[]
  rebase: { status: 'not_attempted'; automatic: false }
}
export interface ReplayedOperationResult extends OperationResultMetadata {
  status: 'replayed'
  replayed_operation_id: OperationId
  timeline: TimelineState
  commands: readonly AppliedCommandResult[]
  rebase: { status: 'not_attempted'; automatic: false }
}
export interface RejectedOperationResult {
  status: 'rejected'
  timeline_id: TimelineId
  operation_id: OperationId
  idempotency_key: IdempotencyKey
  base_revision: TimelineRevision
  error: VideoCommandError
}
export type EditApplyResult =
  | AppliedOperationResult
  | ReplayedOperationResult
  | RejectedOperationResult
export type ApplyResult = EditApplyResult

export type VideoCommandErrorCode =
  | 'invalid_request'
  | 'invalid_timeline'
  | 'revision_conflict'
  | 'precondition_failed'
  | 'idempotency_conflict'
  | 'operation_in_progress'
  | 'unknown_timeline'
  | 'unknown_media'
  | 'unknown_track'
  | 'unknown_item'
  | 'media_unavailable'
  | 'unsupported_command'
  | 'limit_exceeded'
  | 'permission_denied'

export interface RevisionConflictDetails {
  kind: 'revision_conflict'
  base_revision: TimelineRevision
  current_revision: TimelineRevision
  rebase: {
    status: 'required'
    automatic: false
    strategy: 'refresh_then_resubmit'
    retry_with_revision: TimelineRevision
  }
  changed_operation_ids?: readonly OperationId[]
}
export interface PreconditionsFailedDetails {
  kind: 'precondition_failed'
  precondition_index: number
  precondition: Precondition
  actual: Readonly<Record<string, string | number | boolean | null>>
}
export interface IdempotencyConflictDetails {
  kind: 'idempotency_conflict'
  idempotency_key: IdempotencyKey
  original_operation_id: OperationId
}
export interface InvalidRequestDetails {
  kind: 'invalid_request'
  path: string
  reason: string
}
export interface InvalidTimelineDetails {
  kind: 'invalid_timeline'
  path: string
  reason: string
}
export interface ResourceErrorDetails {
  kind: 'resource'
  resource: 'timeline' | 'media' | 'track' | 'item'
  id: string
}
export interface LimitErrorDetails {
  kind: 'limit'
  path: string
  limit: number
  actual: number
}
export interface GenericErrorDetails {
  kind: 'generic'
  reason: string
  path?: string
}
export type VideoCommandErrorDetails =
  | RevisionConflictDetails
  | PreconditionsFailedDetails
  | IdempotencyConflictDetails
  | InvalidRequestDetails
  | InvalidTimelineDetails
  | ResourceErrorDetails
  | LimitErrorDetails
  | GenericErrorDetails
export interface VideoCommandError {
  code: VideoCommandErrorCode
  message: string
  retryable: boolean
  operation_id?: OperationId
  command_id?: CommandId
  details: VideoCommandErrorDetails
}

export interface ValidationSuccess<T> {
  ok: true
  value: T
}
export interface ValidationFailure {
  ok: false
  errors: readonly VideoCommandError[]
}
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export function isStableIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

export function isMicroseconds(value: unknown): value is Microseconds {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function asMicroseconds(value: number): Microseconds {
  if (!isMicroseconds(value)) throw new Error('Microseconds must be a safe, non-negative integer')
  return value
}

export function isTimelineRevision(value: unknown): value is TimelineRevision {
  return isMicroseconds(value)
}

export function asTimelineRevision(value: number): TimelineRevision {
  if (!isTimelineRevision(value))
    throw new Error('Timeline revisions must be safe, non-negative integers')
  return value
}

export function asStableIdentifier<T extends string>(value: string): T {
  if (!isStableIdentifier(value))
    throw new Error(`Identifier must be 1-${MAX_ID_LENGTH} non-whitespace characters`)
  return value as T
}

export function isVideoCommandError(value: unknown): value is VideoCommandError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VideoCommandError>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.details === 'object' &&
    candidate.details !== null
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidRequest(path: string, reason: string): VideoCommandError {
  return {
    code: 'invalid_request',
    message: `${path}: ${reason}`,
    retryable: false,
    details: { kind: 'invalid_request', path, reason },
  }
}

function invalidTimeline(path: string, reason: string): VideoCommandError {
  return {
    code: 'invalid_timeline',
    message: `${path}: ${reason}`,
    retryable: false,
    details: { kind: 'invalid_timeline', path, reason },
  }
}

function checkIdentifier(
  value: unknown,
  path: string,
  errors: VideoCommandError[],
): value is string {
  if (!isStableIdentifier(value)) {
    errors.push(
      invalidRequest(path, `must be a non-empty identifier of at most ${MAX_ID_LENGTH} characters`),
    )
    return false
  }
  return true
}

function checkMicroseconds(value: unknown, path: string, errors: VideoCommandError[]): boolean {
  if (!isMicroseconds(value)) {
    errors.push(invalidRequest(path, 'must be a safe, non-negative integer in microseconds'))
    return false
  }
  return true
}

function checkString(
  value: unknown,
  path: string,
  errors: VideoCommandError[],
  max = MAX_TEXT_LENGTH,
): boolean {
  if (typeof value !== 'string' || value.length > max) {
    errors.push(invalidRequest(path, `must be a string of at most ${max} characters`))
    return false
  }
  return true
}

function checkInterval(
  start: unknown,
  end: unknown,
  path: string,
  errors: VideoCommandError[],
): boolean {
  const startOk = checkMicroseconds(start, `${path}.start_us`, errors)
  const endOk = checkMicroseconds(end, `${path}.end_us`, errors)
  if (startOk && endOk && (end as number) <= (start as number)) {
    errors.push(invalidRequest(path, 'end must be greater than start'))
    return false
  }
  return startOk && endOk
}

function checkIndex(value: unknown, path: string, errors: VideoCommandError[]): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    errors.push(invalidRequest(path, 'must be a non-negative integer'))
  }
}

function checkArray(value: unknown, path: string, errors: VideoCommandError[]): value is unknown[] {
  if (!Array.isArray(value)) {
    errors.push(invalidRequest(path, 'must be an array'))
    return false
  }
  return true
}

function checkTrackKind(value: unknown): value is TrackKind {
  return typeof value === 'string' && (TRACK_KINDS as readonly string[]).includes(value)
}

function checkMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)
}

function validateMedia(value: unknown, path: string, errors: VideoCommandError[]): void {
  if (!isRecord(value)) {
    errors.push(invalidRequest(path, 'must be an object'))
    return
  }
  checkIdentifier(value.media_id, `${path}.media_id`, errors)
  if (!checkMediaKind(value.media_kind))
    errors.push(invalidRequest(`${path}.media_kind`, 'must be video, audio, or image'))
  checkIdentifier(value.content_hash, `${path}.content_hash`, errors)
  if (value.duration_us !== null)
    checkMicroseconds(value.duration_us, `${path}.duration_us`, errors)
  if (!isRecord(value.availability)) {
    errors.push(invalidRequest(`${path}.availability`, 'must be an object'))
    return
  }
  const mode = value.availability.mode
  if (mode !== 'local' && mode !== 'cloud' && mode !== 'hybrid') {
    errors.push(invalidRequest(`${path}.availability.mode`, 'must be local, cloud, or hybrid'))
    return
  }
  const local = value.availability.local
  const cloud = value.availability.cloud
  if (mode !== 'cloud' && !isRecord(local))
    errors.push(invalidRequest(`${path}.availability.local`, 'is required'))
  if (mode !== 'local' && !isRecord(cloud))
    errors.push(invalidRequest(`${path}.availability.cloud`, 'is required'))
  if (isRecord(local)) {
    checkIdentifier(local.device_id, `${path}.availability.local.device_id`, errors)
    checkIdentifier(local.root_id, `${path}.availability.local.root_id`, errors)
    checkIdentifier(local.file_id, `${path}.availability.local.file_id`, errors)
    if (
      typeof local.root_generation !== 'number' ||
      !Number.isSafeInteger(local.root_generation) ||
      local.root_generation < 1
    ) {
      errors.push(
        invalidRequest(
          `${path}.availability.local.root_generation`,
          'must be a positive safe integer',
        ),
      )
    }
  }
  if (isRecord(cloud))
    checkIdentifier(cloud.object_id, `${path}.availability.cloud.object_id`, errors)
}

function validateCaptionCue(
  value: unknown,
  path: string,
  errors: VideoCommandError[],
): value is CaptionCue {
  if (!isRecord(value)) {
    errors.push(invalidRequest(path, 'must be an object'))
    return false
  }
  if (value.item_type !== 'caption_cue')
    errors.push(invalidRequest(`${path}.item_type`, 'must be caption_cue'))
  checkIdentifier(value.cue_id, `${path}.cue_id`, errors)
  checkIdentifier(value.track_id, `${path}.track_id`, errors)
  checkInterval(value.start_us, value.end_us, path, errors)
  checkString(value.text, `${path}.text`, errors)
  if (value.speaker !== undefined && value.speaker !== null)
    checkString(value.speaker, `${path}.speaker`, errors, MAX_ID_LENGTH)
  return true
}

function validateTimelineItem(
  value: unknown,
  path: string,
  errors: VideoCommandError[],
): value is TimelineItem {
  if (!isRecord(value)) {
    errors.push(invalidTimeline(path, 'must be an object'))
    return false
  }
  if (value.item_type === 'caption_cue') return validateCaptionCue(value, path, errors)
  if (value.item_type !== 'clip' && value.item_type !== 'text') {
    errors.push(invalidTimeline(`${path}.item_type`, 'must be clip, text, or caption_cue'))
    return false
  }
  checkIdentifier(value.item_id, `${path}.item_id`, errors)
  checkIdentifier(value.track_id, `${path}.track_id`, errors)
  checkInterval(value.timeline_start_us, value.timeline_end_us, `${path}.timeline`, errors)
  if (value.item_type === 'clip') {
    checkIdentifier(value.media_id, `${path}.media_id`, errors)
    if (!checkMediaKind(value.media_kind))
      errors.push(invalidTimeline(`${path}.media_kind`, 'must be video, audio, or image'))
    checkInterval(value.source_start_us, value.source_end_us, `${path}.source`, errors)
  } else {
    checkString(value.text, `${path}.text`, errors)
  }
  return true
}

function validateTrack(
  value: unknown,
  path: string,
  errors: VideoCommandError[],
): value is TimelineTrack {
  if (!isRecord(value)) {
    errors.push(invalidTimeline(path, 'must be an object'))
    return false
  }
  checkIdentifier(value.track_id, `${path}.track_id`, errors)
  if (!checkTrackKind(value.kind))
    errors.push(invalidTimeline(`${path}.kind`, 'must be video, audio, overlay, or caption'))
  checkString(value.name, `${path}.name`, errors, MAX_ID_LENGTH)
  if (value.language !== undefined) checkString(value.language, `${path}.language`, errors, 32)
  if (typeof value.locked !== 'boolean')
    errors.push(invalidTimeline(`${path}.locked`, 'must be a boolean'))
  if (typeof value.muted !== 'boolean')
    errors.push(invalidTimeline(`${path}.muted`, 'must be a boolean'))
  if (!Array.isArray(value.items)) {
    errors.push(invalidTimeline(`${path}.items`, 'must be an array'))
    return false
  }
  if (value.items.length > MAX_ITEMS_PER_TRACK)
    errors.push(
      invalidTimeline(`${path}.items`, `must contain at most ${MAX_ITEMS_PER_TRACK} items`),
    )
  return true
}

export function validateTimelineState(input: unknown): ValidationResult<TimelineState> {
  const errors: VideoCommandError[] = []
  if (!isRecord(input))
    return { ok: false, errors: [invalidTimeline('timeline', 'must be an object')] }
  if (input.contract_version !== VIDEO_COMMAND_CONTRACT_VERSION)
    errors.push(invalidTimeline('contract_version', 'is not supported'))
  if (input.schema_version !== VIDEO_TIMELINE_SCHEMA_VERSION)
    errors.push(invalidTimeline('schema_version', 'is not supported'))
  checkIdentifier(input.timeline_id, 'timeline_id', errors)
  if (!isTimelineRevision(input.revision))
    errors.push(invalidTimeline('revision', 'must be a safe, non-negative integer'))
  checkMicroseconds(input.duration_us, 'duration_us', errors)

  const mediaIds = new Set<string>()
  if (!Array.isArray(input.media)) errors.push(invalidTimeline('media', 'must be an array'))
  else {
    for (const [index, media] of input.media.entries()) {
      const path = `media[${index}]`
      validateMedia(media, path, errors)
      if (isRecord(media) && isStableIdentifier(media.media_id)) {
        if (mediaIds.has(media.media_id))
          errors.push(invalidTimeline(`${path}.media_id`, 'must be unique'))
        mediaIds.add(media.media_id)
      }
    }
  }
  const mediaValues = Array.isArray(input.media) ? input.media : []

  const trackIds = new Set<string>()
  const itemIds = new Set<string>()
  if (!Array.isArray(input.tracks)) errors.push(invalidTimeline('tracks', 'must be an array'))
  else {
    if (input.tracks.length > MAX_TRACKS_PER_TIMELINE)
      errors.push(
        invalidTimeline('tracks', `must contain at most ${MAX_TRACKS_PER_TIMELINE} tracks`),
      )
    for (const [trackIndex, track] of input.tracks.entries()) {
      const path = `tracks[${trackIndex}]`
      if (!validateTrack(track, path, errors) || !isRecord(track)) continue
      const trackId = String(track.track_id)
      if (trackIds.has(trackId)) errors.push(invalidTimeline(`${path}.track_id`, 'must be unique'))
      trackIds.add(trackId)
      if (!Array.isArray(track.items)) continue
      for (const [itemIndex, item] of track.items.entries()) {
        const itemPath = `${path}.items[${itemIndex}]`
        if (!validateTimelineItem(item, itemPath, errors) || !isRecord(item)) continue
        const id = item.item_type === 'caption_cue' ? item.cue_id : item.item_id
        if (isStableIdentifier(id)) {
          if (itemIds.has(id)) errors.push(invalidTimeline(itemPath, 'item ID must be unique'))
          itemIds.add(id)
        }
        if (item.track_id !== track.track_id)
          errors.push(invalidTimeline(`${itemPath}.track_id`, 'must match its containing track'))
        if (item.item_type === 'clip') {
          const media = mediaValues.find(
            (candidate: unknown) => isRecord(candidate) && candidate.media_id === item.media_id,
          )
          if (!media)
            errors.push(invalidTimeline(`${itemPath}.media_id`, 'must reference timeline.media'))
          else if (media.media_kind !== item.media_kind)
            errors.push(
              invalidTimeline(`${itemPath}.media_kind`, 'must match the referenced media'),
            )
        }
        if (track.kind === 'caption' && item.item_type !== 'caption_cue')
          errors.push(invalidTimeline(itemPath, 'caption tracks may only contain caption cues'))
        if (track.kind !== 'caption' && item.item_type === 'caption_cue')
          errors.push(invalidTimeline(itemPath, 'caption cues must belong to a caption track'))
        if (track.kind === 'audio' && item.item_type === 'clip' && item.media_kind !== 'audio')
          errors.push(invalidTimeline(itemPath, 'audio tracks may only contain audio clips'))
        const end = item.item_type === 'caption_cue' ? item.end_us : item.timeline_end_us
        if (isMicroseconds(end) && isMicroseconds(input.duration_us) && end > input.duration_us)
          errors.push(invalidTimeline(itemPath, 'item must end within timeline duration'))
      }
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as TimelineState }
}

function validatePrecondition(value: unknown, path: string, errors: VideoCommandError[]): void {
  if (!isRecord(value)) {
    errors.push(invalidRequest(path, 'must be an object'))
    return
  }
  if (typeof value.type !== 'string') {
    errors.push(invalidRequest(`${path}.type`, 'is required'))
    return
  }
  switch (value.type) {
    case 'track_exists':
    case 'track_absent':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      break
    case 'item_exists':
    case 'item_absent':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      break
    case 'item_at':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      checkInterval(value.timeline_start_us, value.timeline_end_us, `${path}.timeline`, errors)
      break
    case 'media_content_hash':
      checkIdentifier(value.media_id, `${path}.media_id`, errors)
      checkIdentifier(value.content_hash, `${path}.content_hash`, errors)
      break
    case 'caption_cue_at':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      checkIdentifier(value.cue_id, `${path}.cue_id`, errors)
      checkInterval(value.start_us, value.end_us, path, errors)
      checkString(value.text, `${path}.text`, errors)
      break
    default:
      errors.push(invalidRequest(`${path}.type`, 'is not a supported precondition'))
  }
}

function validateCommand(value: unknown, path: string, errors: VideoCommandError[]): void {
  if (!isRecord(value)) {
    errors.push(invalidRequest(path, 'must be an object'))
    return
  }
  checkIdentifier(value.command_id, `${path}.command_id`, errors)
  if (typeof value.type !== 'string') {
    errors.push(invalidRequest(`${path}.type`, 'is required'))
    return
  }
  switch (value.type) {
    case 'add_clip':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.index !== undefined) checkIndex(value.index, `${path}.index`, errors)
      if (!isRecord(value.item)) errors.push(invalidRequest(`${path}.item`, 'must be an object'))
      else {
        if (value.item.item_type !== 'clip')
          errors.push(invalidRequest(`${path}.item.item_type`, 'must be clip'))
        validateTimelineItem(value.item, `${path}.item`, errors)
        if (value.item.track_id !== value.track_id)
          errors.push(invalidRequest(`${path}.item.track_id`, 'must match track_id'))
      }
      break
    case 'add_text':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.index !== undefined) checkIndex(value.index, `${path}.index`, errors)
      if (!isRecord(value.item)) errors.push(invalidRequest(`${path}.item`, 'must be an object'))
      else {
        if (value.item.item_type !== 'text')
          errors.push(invalidRequest(`${path}.item.item_type`, 'must be text'))
        validateTimelineItem(value.item, `${path}.item`, errors)
        if (value.item.track_id !== value.track_id)
          errors.push(invalidRequest(`${path}.item.track_id`, 'must match track_id'))
      }
      break
    case 'duplicate_item':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      checkIdentifier(value.new_item_id, `${path}.new_item_id`, errors)
      checkIdentifier(value.to_track_id, `${path}.to_track_id`, errors)
      if (value.item_id === value.new_item_id)
        errors.push(invalidRequest(path, 'new item ID must differ from source item ID'))
      if (value.timeline_start_us !== undefined)
        checkMicroseconds(value.timeline_start_us, `${path}.timeline_start_us`, errors)
      if (value.index !== undefined) checkIndex(value.index, `${path}.index`, errors)
      break
    case 'remove_item':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      break
    case 'move_item':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      checkIdentifier(value.to_track_id, `${path}.to_track_id`, errors)
      checkMicroseconds(value.timeline_start_us, `${path}.timeline_start_us`, errors)
      checkIndex(value.index, `${path}.index`, errors)
      break
    case 'trim_item':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      if (value.edge !== 'start' && value.edge !== 'end')
        errors.push(invalidRequest(`${path}.edge`, 'must be start or end'))
      checkMicroseconds(value.timeline_us, `${path}.timeline_us`, errors)
      checkMicroseconds(value.source_us, `${path}.source_us`, errors)
      break
    case 'split_item':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      checkMicroseconds(value.at_timeline_us, `${path}.at_timeline_us`, errors)
      checkMicroseconds(value.at_source_us, `${path}.at_source_us`, errors)
      checkIdentifier(value.left_item_id, `${path}.left_item_id`, errors)
      checkIdentifier(value.right_item_id, `${path}.right_item_id`, errors)
      if (new Set([value.item_id, value.left_item_id, value.right_item_id]).size !== 3)
        errors.push(invalidRequest(path, 'split item IDs must all be distinct'))
      break
    case 'ripple_delete':
      checkInterval(value.start_us, value.end_us, path, errors)
      if (value.track_ids !== null && !checkArray(value.track_ids, `${path}.track_ids`, errors))
        return
      if (Array.isArray(value.track_ids)) {
        const ids = new Set<string>()
        for (const [index, id] of value.track_ids.entries()) {
          if (checkIdentifier(id, `${path}.track_ids[${index}]`, errors)) {
            if (ids.has(id))
              errors.push(invalidRequest(`${path}.track_ids[${index}]`, 'must be unique'))
            ids.add(id)
          }
        }
      }
      break
    case 'add_track':
      checkIndex(value.index, `${path}.index`, errors)
      if (!isRecord(value.track)) errors.push(invalidRequest(`${path}.track`, 'must be an object'))
      else {
        checkIdentifier(value.track.track_id, `${path}.track.track_id`, errors)
        if (!checkTrackKind(value.track.kind))
          errors.push(invalidRequest(`${path}.track.kind`, 'must be a supported track kind'))
        checkString(value.track.name, `${path}.track.name`, errors, MAX_ID_LENGTH)
        if (
          value.track.items !== undefined &&
          (!Array.isArray(value.track.items) || value.track.items.length !== 0)
        )
          errors.push(
            invalidRequest(`${path}.track.items`, 'must be omitted or empty when adding a track'),
          )
      }
      break
    case 'remove_track':
    case 'move_track':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.type === 'move_track') checkIndex(value.to_index, `${path}.to_index`, errors)
      break
    case 'update_track':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.name !== undefined) checkString(value.name, `${path}.name`, errors, MAX_ID_LENGTH)
      if (value.language !== undefined && value.language !== null)
        checkString(value.language, `${path}.language`, errors, 32)
      if (value.locked !== undefined && typeof value.locked !== 'boolean')
        errors.push(invalidRequest(`${path}.locked`, 'must be a boolean'))
      if (value.muted !== undefined && typeof value.muted !== 'boolean')
        errors.push(invalidRequest(`${path}.muted`, 'must be a boolean'))
      break
    case 'add_caption_track':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      checkString(value.name, `${path}.name`, errors, MAX_ID_LENGTH)
      checkString(value.language, `${path}.language`, errors, 32)
      checkIndex(value.index, `${path}.index`, errors)
      break
    case 'remove_caption_track':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      break
    case 'update_caption_track':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.name !== undefined) checkString(value.name, `${path}.name`, errors, MAX_ID_LENGTH)
      if (value.language !== undefined) checkString(value.language, `${path}.language`, errors, 32)
      break
    case 'upsert_caption_cues':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (checkArray(value.cues, `${path}.cues`, errors)) {
        if (value.cues.length > MAX_CAPTION_CUES_PER_COMMAND)
          errors.push(
            invalidRequest(
              `${path}.cues`,
              `must contain at most ${MAX_CAPTION_CUES_PER_COMMAND} cues`,
            ),
          )
        const ids = new Set<string>()
        for (const [index, cue] of value.cues.entries()) {
          validateCaptionCue(cue, `${path}.cues[${index}]`, errors)
          if (isRecord(cue) && cue.track_id !== value.track_id)
            errors.push(invalidRequest(`${path}.cues[${index}].track_id`, 'must match track_id'))
          if (isRecord(cue) && isStableIdentifier(cue.cue_id)) {
            if (ids.has(cue.cue_id))
              errors.push(
                invalidRequest(
                  `${path}.cues[${index}].cue_id`,
                  'must be unique within the command',
                ),
              )
            ids.add(cue.cue_id)
          }
        }
      }
      break
    case 'remove_caption_cues':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (checkArray(value.cue_ids, `${path}.cue_ids`, errors)) {
        const ids = new Set<string>()
        for (const [index, id] of value.cue_ids.entries()) {
          if (checkIdentifier(id, `${path}.cue_ids[${index}]`, errors)) {
            if (ids.has(id))
              errors.push(invalidRequest(`${path}.cue_ids[${index}]`, 'must be unique'))
            ids.add(id)
          }
        }
      }
      break
    case 'set_item_properties':
      checkIdentifier(value.item_id, `${path}.item_id`, errors)
      if (!isRecord(value.properties))
        errors.push(invalidRequest(`${path}.properties`, 'must be an object'))
      else if (value.properties.text !== undefined)
        checkString(value.properties.text, `${path}.properties.text`, errors)
      break
    case 'set_caption_style':
      checkIdentifier(value.track_id, `${path}.track_id`, errors)
      if (value.cue_ids !== null && checkArray(value.cue_ids, `${path}.cue_ids`, errors)) {
        for (const [index, id] of value.cue_ids.entries())
          checkIdentifier(id, `${path}.cue_ids[${index}]`, errors)
      }
      if (!isRecord(value.style)) errors.push(invalidRequest(`${path}.style`, 'must be an object'))
      break
    case 'request_job':
      if (
        !(
          typeof value.job_type === 'string' &&
          (VIDEO_JOB_TYPES as readonly string[]).includes(value.job_type)
        )
      )
        errors.push(invalidRequest(`${path}.job_type`, 'is not a supported job type'))
      if (value.media_id !== undefined) checkIdentifier(value.media_id, `${path}.media_id`, errors)
      if (value.timeline_revision !== undefined && !isTimelineRevision(value.timeline_revision))
        errors.push(
          invalidRequest(`${path}.timeline_revision`, 'must be a safe, non-negative integer'),
        )
      if (value.options !== undefined && !isRecord(value.options))
        errors.push(invalidRequest(`${path}.options`, 'must be an object'))
      break
    default:
      errors.push(invalidRequest(`${path}.type`, 'is not a supported command'))
  }
}

export function validateCommandBatch(input: unknown): ValidationResult<EditCommandBatch> {
  const errors: VideoCommandError[] = []
  if (!isRecord(input))
    return { ok: false, errors: [invalidRequest('request', 'must be an object')] }
  if (input.contract_version !== VIDEO_COMMAND_CONTRACT_VERSION)
    errors.push(invalidRequest('contract_version', 'is not supported'))
  checkIdentifier(input.timeline_id, 'timeline_id', errors)
  checkIdentifier(input.operation_id, 'operation_id', errors)
  checkIdentifier(input.idempotency_key, 'idempotency_key', errors)
  if (!isTimelineRevision(input.base_revision))
    errors.push(invalidRequest('base_revision', 'must be a safe, non-negative integer'))
  if (checkArray(input.preconditions, 'preconditions', errors)) {
    if (input.preconditions.length > MAX_PRECONDITIONS_PER_OPERATION)
      errors.push(
        invalidRequest(
          'preconditions',
          `must contain at most ${MAX_PRECONDITIONS_PER_OPERATION} entries`,
        ),
      )
    for (const [index, precondition] of input.preconditions.entries())
      validatePrecondition(precondition, `preconditions[${index}]`, errors)
  }
  if (checkArray(input.commands, 'commands', errors)) {
    if (input.commands.length === 0)
      errors.push(invalidRequest('commands', 'must contain at least one command'))
    if (input.commands.length > MAX_COMMANDS_PER_OPERATION)
      errors.push(
        invalidRequest('commands', `must contain at most ${MAX_COMMANDS_PER_OPERATION} commands`),
      )
    const commandIds = new Set<string>()
    for (const [index, command] of input.commands.entries()) {
      validateCommand(command, `commands[${index}]`, errors)
      if (isRecord(command) && isStableIdentifier(command.command_id)) {
        if (commandIds.has(command.command_id))
          errors.push(
            invalidRequest(`commands[${index}].command_id`, 'must be unique within the batch'),
          )
        commandIds.add(command.command_id)
      }
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EditCommandBatch }
}
