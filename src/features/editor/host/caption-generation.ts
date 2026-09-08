import { makeCaptionOperationId } from '../codepress/caption-commands'
import { validateCommandBatch } from '../codepress/contract'
import type { FreeCutFrameDocument } from '../codepress/document'
import { framesToMicroseconds } from '../codepress/timing'
import {
  MAX_TRANSCRIPT_SELECTIONS,
  type EditorTranscriptPort,
  type HostTranscriptCommandPreview,
  type HostTranscriptCommandPreviewRequest,
  type HostTranscriptSection,
  type HostTranscriptStatusReceipt,
} from './contract'
import {
  hasUsableHostWordTiming,
  hostWordSelectionRanges,
  mapHostTranscriptWords,
} from './transcript-words'

/** Caption ranges describe only the footage remaining in each edited occurrence. */
export function captionRangesForEdit(
  document: FreeCutFrameDocument,
  assetId: string,
  sections: readonly HostTranscriptSection[],
  selectedItemIds?: ReadonlySet<string>,
) {
  const scopedClips = document.tracks
    .flatMap((track) => track.items)
    .filter(
      (item) =>
        (item.type === 'video' || item.type === 'audio') &&
        (!selectedItemIds || selectedItemIds.has(item.id)),
    )
  if (
    scopedClips.some(
      (item) => (item.type === 'video' || item.type === 'audio') && item.mediaId !== assetId,
    )
  ) {
    throw new Error(
      'This scope includes media without the current host transcript. Choose a clip belonging to that transcript, Caption generation currently supports only the host’s current transcript source.',
    )
  }
  if (sections.some((section) => !hasUsableHostWordTiming(section))) {
    throw new Error(
      'No timed transcript can be used safely: measured word timing is missing or incomplete. Caption creation from this transcript is unavailable.',
    )
  }
  const clips = new Map(
    document.tracks.flatMap((track) => track.items).map((item) => [item.id, item]),
  )
  // Scope before linked-cohort deduplication so individually selected audio retains its identity.
  const scopedDocument = selectedItemIds
    ? {
        ...document,
        tracks: document.tracks.map((track) => ({
          ...track,
          items: track.items.filter((item) => selectedItemIds.has(item.id)),
        })),
      }
    : document
  const words = mapHostTranscriptWords(scopedDocument, assetId, sections).map((word) => {
    const clip = clips.get(word.itemId)!
    if (clip.type !== 'video' && clip.type !== 'audio') return word
    return {
      ...word,
      sourceStartUs: Math.max(
        word.sourceStartUs,
        framesToMicroseconds(clip.sourceStart ?? 0, document.fps),
      ),
      sourceEndUs: Math.min(
        word.sourceEndUs,
        framesToMicroseconds(
          clip.sourceEnd ?? (clip.sourceStart ?? 0) + clip.durationInFrames * (clip.speed ?? 1),
          document.fps,
        ),
      ),
    }
  })
  const ranges = hostWordSelectionRanges(words)
  if (!ranges.length)
    throw new Error(
      'No timed transcript words remain in this scope. Select a clip covered by the current transcript.',
    )
  if (ranges.length > MAX_TRANSCRIPT_SELECTIONS)
    throw new Error(
      `This edit needs more than ${MAX_TRANSCRIPT_SELECTIONS} caption ranges. Choose Selected clip to create a smaller caption batch.`,
    )
  return ranges
}

export async function loadCaptionSections(port: EditorTranscriptPort, transcriptId: string) {
  const sections: HostTranscriptSection[] = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
    const page = await port.getSections({ transcriptId, cursor, limit: 50 })
    if (page.transcriptId !== transcriptId)
      throw new Error('The transcript changed. Reload captions and try again.')
    sections.push(...page.sections)
    if (!page.hasMore) return sections
    if (!page.nextCursor || cursors.has(page.nextCursor))
      throw new Error('The transcript could not be loaded completely. Retry loading captions.')
    cursor = page.nextCursor
    cursors.add(cursor)
  }
  throw new Error('This transcript is too large to load here. Choose a shorter edit.')
}

const CAPTION_COMMANDS = new Set([
  'add_caption_track',
  'update_caption_track',
  'remove_caption_track',
  'upsert_caption_cues',
  'remove_caption_cues',
  'set_caption_style',
])

/** Never allow a caption preview to smuggle a footage edit or a different revision. */
export function validateCaptionPreview(
  preview: HostTranscriptCommandPreview,
  request: HostTranscriptCommandPreviewRequest,
  timelineId: string,
) {
  const validation = validateCommandBatch(preview.commandBatch)
  if (
    !validation.ok ||
    preview.transcriptId !== request.transcriptId ||
    preview.assetId !== request.assetId ||
    preview.sourceAssetHash !== request.sourceAssetHash ||
    preview.timelineId !== timelineId ||
    preview.baseRevision !== request.baseRevision ||
    preview.preview.willMutateTimeline !== false ||
    (preview.preview.action !== undefined &&
      !['caption', 'captions'].includes(preview.preview.action)) ||
    preview.commandBatch.timeline_id !== timelineId ||
    preview.commandBatch.base_revision !== request.baseRevision ||
    preview.commandBatch.operation_id !== preview.operationId ||
    preview.commandBatch.idempotency_key !== preview.idempotencyKey ||
    !preview.commandBatch.commands.length ||
    !preview.commandBatch.commands.every(
      (command) =>
        CAPTION_COMMANDS.has(command.type) &&
        'track_id' in command &&
        command.track_id === request.captionTrackId,
    )
  ) {
    throw new Error('The caption preview does not match this edit. Reload captions and try again.')
  }
  return preview
}

export function captionStatusOrThrow(
  status: HostTranscriptStatusReceipt | null,
): HostTranscriptStatusReceipt & { assetId: string } {
  if (status?.status === 'succeeded' && status.assetId)
    return { ...status, assetId: status.assetId }
  const pending = status?.status === 'pending' || status?.status === 'running'
  throw new Error(
    pending
      ? 'Transcription is still processing. Return to Transcript to follow progress, then retry.'
      : 'A completed transcript is needed. Open Transcript to check available transcription options, then return here.',
  )
}

export function assertCaptionTargetAvailable(document: FreeCutFrameDocument, replaceAll: boolean) {
  const index = document.tracks.findIndex((track) => track.id === 'host-transcript-captions')
  const track = document.tracks[index]
  if (!track) return
  if (track.locked)
    throw new Error('The generated caption track is locked. Unlock it before replacing captions.')
  if (!replaceAll)
    throw new Error(
      'Choose Replace all cues to replace Transcript captions, including manual corrections.',
    )
  if (
    document.tracks
      .slice(0, index)
      .some((candidate) => candidate.kind === 'video' || candidate.kind === 'overlay')
  ) {
    throw new Error(
      'This caption track is below video and may be hidden. Remove this track using Remove track below, then preview captions to create a new top track. Removing a track discards its manual corrections.',
    )
  }
}

export function replaceGeneratedCaptionCues(
  preview: HostTranscriptCommandPreview,
  request: HostTranscriptCommandPreviewRequest,
  document: FreeCutFrameDocument,
) {
  const previousCues =
    document.tracks
      .find((track) => track.id === request.captionTrackId)
      ?.items.filter((item) => item.type === 'caption_cue') ?? []
  const commands = preview.commandBatch.commands.map((command) =>
    command.type === 'add_caption_track' ? { ...command, index: 0 } : command,
  )
  const replacement = {
    ...preview,
    commandBatch: {
      ...preview.commandBatch,
      commands: [
        ...(previousCues.length
          ? [
              {
                type: 'remove_caption_cues' as const,
                command_id: makeCaptionOperationId('replace-captions'),
                track_id: request.captionTrackId!,
                cue_ids: previousCues.map((cue) => cue.id),
              },
            ]
          : []),
        ...commands,
      ],
    },
  }
  return validateCaptionPreview(replacement, request, document.timelineId)
}
