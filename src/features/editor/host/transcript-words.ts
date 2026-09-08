import type { FreeCutFrameDocument } from '../codepress/document'
import { framesToMicroseconds } from '../codepress/timing'
import type { HostTranscriptRange, HostTranscriptSection } from './contract'

export interface HostWordOccurrence {
  key: string
  itemId: string
  wordIndex: number
  sectionId: string
  revision: number
  text: string
  sourceStartUs: number
  sourceEndUs: number
  /** Unrounded frame coordinates; quantization belongs to the command boundary. */
  startFrame: number
  endFrame: number
}

/** Project source words into the current edit, retaining each distinct occurrence. */
export function mapHostTranscriptWords(
  document: FreeCutFrameDocument,
  assetId: string,
  sections: readonly HostTranscriptSection[],
): HostWordOccurrence[] {
  const words: HostWordOccurrence[] = []
  const linked = new Set<string>()
  const clips = document.tracks
    .flatMap((track) => track.items)
    .filter((item) => (item.type === 'video' || item.type === 'audio') && item.mediaId === assetId)
    .sort((a, b) => Number(a.type !== 'video') - Number(b.type !== 'video'))
  for (const clip of clips) {
    if (clip.type !== 'video' && clip.type !== 'audio') continue
    const cohort = clip.linkedGroupId
      ? `${clip.linkedGroupId}:${clip.mediaId}:${clip.from}:${clip.durationInFrames}:${clip.sourceStart}:${clip.sourceEnd}:${clip.speed ?? 1}`
      : null
    if (cohort && linked.has(cohort)) continue
    if (cohort) linked.add(cohort)
    const sourceStart = framesToMicroseconds(clip.sourceStart ?? 0, document.fps)
    const sourceEnd = framesToMicroseconds(
      clip.sourceEnd ?? (clip.sourceStart ?? 0) + clip.durationInFrames * (clip.speed ?? 1),
      document.fps,
    )
    if (sourceEnd <= sourceStart) continue
    for (const section of sections) {
      if (section.timingSource !== 'provider') continue
      section.words?.forEach((word, index) => {
        if (word.endUs <= sourceStart || word.startUs >= sourceEnd) return
        const start = Math.max(sourceStart, word.startUs)
        const end = Math.min(sourceEnd, word.endUs)
        words.push({
          key: `${clip.id}:${section.id}:${index}`,
          itemId: clip.id,
          wordIndex: index,
          sectionId: section.id,
          revision: document.revision,
          text: word.text,
          // Preserve the measured word boundaries. The backend intersects the trim.
          sourceStartUs: word.startUs,
          sourceEndUs: word.endUs,
          startFrame:
            clip.from + ((start - sourceStart) / (sourceEnd - sourceStart)) * clip.durationInFrames,
          endFrame:
            clip.from + ((end - sourceStart) / (sourceEnd - sourceStart)) * clip.durationInFrames,
        })
      })
    }
  }
  return words.sort((a, b) => a.startFrame - b.startFrame)
}

/** Adjacent selected words merge only within the same occurrence. */
export function hostWordSelectionRanges(
  words: readonly HostWordOccurrence[],
): HostTranscriptRange[] {
  const ranges: HostTranscriptRange[] = []
  let previousWord: HostWordOccurrence | undefined
  for (const word of words) {
    const previous = ranges.at(-1)
    if (
      previous?.itemId === word.itemId &&
      previousWord?.sectionId === word.sectionId &&
      previousWord.wordIndex + 1 === word.wordIndex
    ) {
      previous.endUs = Math.max(previous.endUs, word.sourceEndUs)
      previous.text += ` ${word.text}`
    } else {
      ranges.push({
        itemId: word.itemId,
        startUs: word.sourceStartUs,
        endUs: word.sourceEndUs,
        text: word.text,
      })
    }
    previousWord = word
  }
  return ranges
}
