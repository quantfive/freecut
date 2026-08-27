// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ExportableSequence } from '@/features/export/deps/timeline-compositions'
import { resolveClientRenderSource } from './client-render-source'

function makeSequence(overrides: Partial<ExportableSequence> = {}): ExportableSequence {
  return {
    id: 'selected',
    name: 'Selected',
    tracks: [],
    items: [],
    transitions: [],
    keyframes: [],
    fps: 24,
    width: 1280,
    height: 720,
    masterBusDb: -3,
    durationFrames: 0,
    inPoint: null,
    outPoint: null,
    markers: [],
    ...overrides,
  }
}

describe('resolveClientRenderSource', () => {
  it('preserves an explicitly unset selected-sequence range and EQ', () => {
    const sequence = makeSequence({ busAudioEq: undefined, backgroundColor: undefined })
    const result = resolveClientRenderSource(
      sequence,
      makeSequence({ id: null, inPoint: 30, outPoint: 90 }),
      {
        busAudioEq: { enabled: true, lowGainDb: 4, midGainDb: 2, highGainDb: 3 },
        masterBusDb: 6,
      },
      { width: 1920, height: 1080, backgroundColor: '#ff0000' },
    )

    expect(result).toMatchObject({
      fps: 24,
      inPoint: null,
      outPoint: null,
      busAudioEq: undefined,
      masterBusDb: -3,
      backgroundColor: undefined,
      width: 1280,
      height: 720,
    })
  })
})
