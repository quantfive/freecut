import { describe, expect, it } from 'vite-plus/test'
import type { FreeCutFrameDocument, FreeCutFrameClip } from '../codepress/document'
import type { HostTranscriptSection } from './contract'
import { hostWordSelectionRanges, mapHostTranscriptWords } from './transcript-words'

const section: HostTranscriptSection = {
  id: 'section',
  transcriptId: 'transcript',
  ordinal: 0,
  startUs: 0,
  endUs: 3_000_000,
  text: 'hello um world',
  timingSource: 'provider',
  words: [
    { text: 'hello', startUs: 0, endUs: 500_000 },
    { text: 'um', startUs: 1_000_000, endUs: 1_200_000 },
    { text: 'world', startUs: 2_000_000, endUs: 3_000_000 },
  ],
}
function document(clips: FreeCutFrameClip[]): FreeCutFrameDocument {
  return {
    timelineId: 'timeline',
    revision: 7,
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 300,
    media: [],
    tracks: [
      { id: 'video', kind: 'video', name: 'Video', locked: false, muted: false, items: clips },
    ],
  }
}
const clip: FreeCutFrameClip = {
  type: 'video',
  id: 'a',
  mediaId: 'media',
  trackId: 'video',
  from: 0,
  durationInFrames: 90,
  sourceStart: 0,
  sourceEnd: 90,
}

describe('host word occurrence mapping', () => {
  it('retains repeated occurrences, clamps trims and maps speed without quantizing provider words', () => {
    const words = mapHostTranscriptWords(
      document([
        clip,
        {
          ...clip,
          id: 'b',
          from: 100,
          sourceStart: 33,
          sourceEnd: 90,
          durationInFrames: 38,
          speed: 1.5,
        },
      ]),
      'media',
      [section],
    )
    expect(words.map((word) => word.key)).toEqual([
      'a:section:0',
      'a:section:1',
      'a:section:2',
      'b:section:1',
      'b:section:2',
    ])
    expect(words[3]).toMatchObject({
      revision: 7,
      itemId: 'b',
      sourceStartUs: 1_000_000,
      startFrame: 100,
      endFrame: 102,
    })
    expect(hostWordSelectionRanges(words.slice(1, 2))).toEqual([
      { itemId: 'a', startUs: 1_000_000, endUs: 1_200_000, text: 'um' },
    ])
    expect(hostWordSelectionRanges(words.slice(2, 4)).map((range) => range.itemId)).toEqual([
      'a',
      'b',
    ])
  })
  it('only deduplicates proven linked same-source/time representations', () => {
    const words = mapHostTranscriptWords(
      document([
        { ...clip, linkedGroupId: 'group' },
        { ...clip, id: 'audio', type: 'audio', linkedGroupId: 'group' },
        { ...clip, id: 'independent', type: 'audio' },
        { ...clip, id: 'different-time', from: 100, linkedGroupId: 'group' },
      ]),
      'media',
      [section],
    )
    expect([...new Set(words.map((word) => word.itemId))]).toEqual([
      'a',
      'independent',
      'different-time',
    ])
  })
  it('rejects incomplete or malformed provider word coverage', () => {
    expect(
      mapHostTranscriptWords(document([clip]), 'media', [
        { ...section, words: section.words!.slice(1) },
      ]),
    ).toEqual([])
    expect(
      mapHostTranscriptWords(document([clip]), 'media', [
        { ...section, words: [{ text: section.text, startUs: NaN, endUs: 3_000_000 }] },
      ]),
    ).toEqual([])
    expect(
      mapHostTranscriptWords(document([clip]), 'media', [
        { ...section, words: [{ text: section.text, startUs: 0, endUs: 3_000_001 }] },
      ]),
    ).toEqual([])
  })

  it('never invents word timing from legacy or synthetic sections and leaves gaps inactive', () => {
    expect(
      mapHostTranscriptWords(document([clip]), 'media', [
        { ...section, timingSource: 'synthetic' },
      ]),
    ).toEqual([])
    expect(
      mapHostTranscriptWords(document([clip]), 'media', [{ ...section, words: null }]),
    ).toEqual([])
    const words = mapHostTranscriptWords(document([clip]), 'media', [section])
    expect(words.find((word) => 20 >= word.startFrame && 20 < word.endFrame)).toBeUndefined()
    expect(hostWordSelectionRanges([words[0]!, words[2]!])).toHaveLength(2)
  })
})
