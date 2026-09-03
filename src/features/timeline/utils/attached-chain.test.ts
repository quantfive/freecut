import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { buildAttachedMoveUpdates, resolveAttachedChain } from './attached-chain'

function clip(
  id: string,
  from: number,
  durationInFrames: number,
  options: Partial<VideoItem> = {},
): VideoItem {
  return {
    type: 'video',
    id,
    trackId: options.trackId ?? 'v1',
    from,
    durationInFrames,
    label: id,
    mediaId: id,
    src: '',
    ...options,
  }
}

describe('attached sequence chains', () => {
  it('resolves only touching forward items and preserves gaps', () => {
    const items = [clip('a', 0, 10), clip('b', 10, 5), clip('gap', 20, 5), clip('tail', 25, 5)]
    expect(resolveAttachedChain(items, 'a')).toEqual(['a', 'b'])
    expect(buildAttachedMoveUpdates(items, 'a', 4)).toEqual([
      { id: 'a', from: 4 },
      { id: 'b', from: 14 },
    ])
  })

  it('treats false as a hard break while missing metadata stays attached', () => {
    const items = [clip('a', 0, 10), clip('b', 10, 5, { rippleLinked: false }), clip('c', 15, 5)]
    expect(resolveAttachedChain(items, 'a')).toEqual(['a'])
    expect(resolveAttachedChain(items, 'b')).toEqual(['b'])
  })

  it('moves linked A/V cohorts with the sequence anchor', () => {
    const items = [
      clip('video-a', 0, 10, { linkedGroupId: 'g' }),
      clip('audio-a', 0, 10, { trackId: 'a1', linkedGroupId: 'g' }),
      clip('video-b', 10, 5),
    ]
    expect(new Set(resolveAttachedChain(items, 'video-a'))).toEqual(
      new Set(['video-a', 'audio-a', 'video-b']),
    )
  })
})
