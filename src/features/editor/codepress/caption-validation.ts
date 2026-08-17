import {
  MAX_CAPTION_CUES_PER_COMMAND,
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  type CaptionStyle,
} from './contract'
import type { FreeCutFrameCaptionCue } from './document'

export type CaptionValidationCode =
  | 'invalid_id'
  | 'invalid_text'
  | 'invalid_range'
  | 'out_of_bounds'
  | 'overlap'
  | 'too_many_cues'

export interface CaptionValidationIssue {
  code: CaptionValidationCode
  message: string
  cue_id?: string
}

export type CaptionFrameCue = FreeCutFrameCaptionCue

function issue(
  code: CaptionValidationCode,
  message: string,
  cue_id?: string,
): CaptionValidationIssue {
  return cue_id === undefined ? { code, message } : { code, message, cue_id }
}

function isSafeFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** Validate a frame-native cue before it is translated into microseconds. */
export function validateFrameCaptionCue(
  cue: CaptionFrameCue,
  durationInFrames: number,
): readonly CaptionValidationIssue[] {
  const issues: CaptionValidationIssue[] = []
  if (cue.id.length === 0 || cue.id.length > MAX_ID_LENGTH)
    issues.push(issue('invalid_id', `Cue IDs must be 1–${MAX_ID_LENGTH} characters`, cue.id))
  if (cue.text.trim().length === 0 || cue.text.length > MAX_TEXT_LENGTH)
    issues.push(
      issue(
        'invalid_text',
        `Cue text must be non-empty and at most ${MAX_TEXT_LENGTH} characters`,
        cue.id,
      ),
    )
  if (!isSafeFrame(cue.from) || !isSafeFrame(cue.durationInFrames) || cue.durationInFrames <= 0)
    issues.push(issue('invalid_range', 'Cue end must be after cue start', cue.id))
  if (
    isSafeFrame(cue.from) &&
    isSafeFrame(cue.durationInFrames) &&
    cue.from + cue.durationInFrames > durationInFrames
  ) {
    issues.push(issue('out_of_bounds', 'Cue must stay within the timeline duration', cue.id))
  }
  return issues
}

/** Validate a complete track view, including deterministic non-overlap rules. */
export function validateFrameCaptionCues(
  cues: readonly CaptionFrameCue[],
  durationInFrames: number,
): readonly CaptionValidationIssue[] {
  const issues: CaptionValidationIssue[] = []
  if (cues.length > MAX_CAPTION_CUES_PER_COMMAND) {
    issues.push(
      issue(
        'too_many_cues',
        `A caption operation may contain at most ${MAX_CAPTION_CUES_PER_COMMAND} cues`,
      ),
    )
  }
  const seen = new Set<string>()
  const sorted = [...cues]
    .map((cue) => {
      if (seen.has(cue.id))
        issues.push(issue('invalid_id', 'Cue IDs must be unique within a track', cue.id))
      seen.add(cue.id)
      issues.push(...validateFrameCaptionCue(cue, durationInFrames))
      return cue
    })
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.from + left.durationInFrames - (right.from + right.durationInFrames),
    )

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const current = sorted[index]!
    if (
      isSafeFrame(previous.from + previous.durationInFrames) &&
      isSafeFrame(current.from) &&
      current.from < previous.from + previous.durationInFrames
    ) {
      issues.push(issue('overlap', `Cue overlaps the preceding cue (${previous.id})`, current.id))
    }
  }
  return issues
}

export function captionStyleOrDefault(style: CaptionStyle | null | undefined): CaptionStyle {
  return {
    font_family: 'Inter',
    font_size: 42,
    color: '#ffffff',
    background_color: '#000000',
    background_opacity: 0.6,
    alignment: 'center',
    ...(style ?? {}),
  }
}
