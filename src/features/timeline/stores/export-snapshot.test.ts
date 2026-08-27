import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { CompositionItem } from '@/types/timeline'
import {
  makeTimelineTrack as makeTrack,
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useCompositionsStore } from './compositions-store'
import { useSequencesStore } from './sequences-store'
import { useCompositionNavigationStore } from './composition-navigation-store'
import { useMarkersStore } from './markers-store'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  getActiveExportSequenceId,
  getExportableSequence,
  listExportableSequences,
} from './actions/export-snapshot'

function seedSequence(id: string, itemId: string, width = 1280, height = 720): void {
  useCompositionsStore.getState().addComposition({
    id,
    name: id,
    tracks: [makeTrack({ id: `${id}-v1`, name: 'V1', kind: 'video', order: 0 })],
    items: [makeVideoItem({ id: itemId, trackId: `${id}-v1`, from: 0, durationInFrames: 50 })],
    transitions: [],
    keyframes: [],
    fps: 24,
    width,
    height,
    durationInFrames: 50,
  })
  useSequencesStore.getState().addTopLevelSequence(id)
}

function seedNestedSequence(): void {
  seedSequence('seq-a', 'a-clip')
  useCompositionsStore.getState().addComposition({
    id: 'child',
    name: 'child',
    tracks: [makeTrack({ id: 'child-v1', name: 'V1', kind: 'video', order: 0 })],
    items: [makeVideoItem({ id: 'child-clip', trackId: 'child-v1', durationInFrames: 30 })],
    transitions: [],
    keyframes: [],
    fps: 24,
    width: 640,
    height: 360,
    durationInFrames: 30,
    busAudioEq: { enabled: true, lowGainDb: 2 },
  })
  useCompositionsStore.getState().updateComposition('seq-a', {
    items: [
      {
        ...makeVideoItem({ id: 'child-entry', trackId: 'seq-a-v1', durationInFrames: 30 }),
        type: 'composition',
        compositionId: 'child',
        compositionWidth: 640,
        compositionHeight: 360,
      } as unknown as CompositionItem,
    ],
    busAudioEq: { enabled: true, lowGainDb: 4 },
  })
}

function makeCompositionEntry(
  id: string,
  compositionId: string,
  trackId: string,
  durationInFrames: number,
): CompositionItem {
  return {
    ...makeVideoItem({ id, trackId, durationInFrames }),
    type: 'composition',
    compositionId,
    compositionWidth: 640,
    compositionHeight: 360,
  } as unknown as CompositionItem
}

function seedMainChildGrandchild(): void {
  useCompositionsStore.getState().addComposition({
    id: 'grandchild',
    name: 'grandchild',
    tracks: [makeTrack({ id: 'grandchild-v1', name: 'V1', kind: 'video', order: 0 })],
    items: [
      makeVideoItem({
        id: 'grandchild-clip',
        trackId: 'grandchild-v1',
        durationInFrames: 20,
      }),
    ],
    transitions: [],
    keyframes: [],
    fps: 24,
    width: 640,
    height: 360,
    durationInFrames: 20,
  })
  useCompositionsStore.getState().addComposition({
    id: 'child',
    name: 'child',
    tracks: [makeTrack({ id: 'child-v1', name: 'V1', kind: 'video', order: 0 })],
    items: [makeCompositionEntry('grandchild-entry', 'grandchild', 'child-v1', 20)],
    transitions: [],
    keyframes: [],
    fps: 24,
    width: 640,
    height: 360,
    durationInFrames: 20,
  })
  useItemsStore.getState().setItems([makeCompositionEntry('child-entry', 'child', 'track-v1', 20)])
}

describe('export-snapshot sourcing', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'main-clip', trackId: 'track-v1', from: 0, durationInFrames: 90 }),
      ])
    useSequencesStore.getState().reset()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('lists Main plus every top-level sequence', () => {
    seedSequence('seq-a', 'a-clip')
    seedSequence('seq-b', 'b-clip')
    expect(listExportableSequences()).toEqual([
      { id: null, name: 'Main Timeline' },
      { id: 'seq-a', name: 'seq-a' },
      { id: 'seq-b', name: 'seq-b' },
    ])
  })

  it('lists composite-2d compositions without promoting them to classic tabs', () => {
    useCompositionsStore.getState().addComposition({
      id: 'motion-title',
      name: 'Motion title',
      editorKind: 'composite-2d',
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1080,
      height: 1080,
      durationInFrames: 150,
    })

    expect(listExportableSequences()).toContainEqual({
      id: 'motion-title',
      name: 'Motion title',
    })
    expect(useSequencesStore.getState().topLevelSequenceIds).not.toContain('motion-title')
  })

  it('reads a non-active sequence from the registry without switching to it', () => {
    seedSequence('seq-a', 'a-clip', 1280, 720)
    // We stay on Main; exporting seq-a must still see its own content/canvas.
    expect(getActiveExportSequenceId()).toBeNull()

    const seq = getExportableSequence('seq-a')
    expect(seq.id).toBe('seq-a')
    expect(seq.items.map((i) => i.id)).toEqual(['a-clip'])
    expect(seq.width).toBe(1280)
    expect(seq.height).toBe(720)
    expect(seq.fps).toBe(24)
    expect(seq.durationFrames).toBe(50)

    // The editor is untouched — still on Main, live stores unchanged.
    expect(getActiveExportSequenceId()).toBeNull()
    expect(useItemsStore.getState().items.map((i) => i.id)).toEqual(['main-clip'])
  })

  it('sources Main from the live root even while a sequence tab is active', () => {
    seedSequence('seq-a', 'a-clip')
    useCompositionNavigationStore.getState().switchToSequence('seq-a')
    expect(getActiveExportSequenceId()).toBe('seq-a')

    // Main is held aside; exporting it must still yield the Main content.
    const main = getExportableSequence(null)
    expect(main.id).toBeNull()
    expect(main.items.map((i) => i.id)).toEqual(['main-clip'])
    expect(main.durationFrames).toBe(90)

    // And the active sequence exports its own content.
    const seq = getExportableSequence('seq-a')
    expect(seq.items.map((i) => i.id)).toEqual(['a-clip'])
  })

  it('binds a drilled child export to the live child mixer without contaminating Main or its tab root', () => {
    const mainEq = { enabled: true, lowGainDb: 1 }
    const sequenceEq = { enabled: true, lowGainDb: 4 }
    const childEq = { enabled: true, lowGainDb: 9 }
    seedNestedSequence()
    usePlaybackStore.getState().setBusAudioEq(mainEq)
    useCompositionsStore.getState().updateComposition('seq-a', { busAudioEq: sequenceEq })
    useCompositionNavigationStore.getState().switchToSequence('seq-a')
    useCompositionNavigationStore.getState().enterComposition('child', 'child', 'child-entry')
    usePlaybackStore.getState().setBusAudioEq(childEq)

    const child = getExportableSequence('child')
    const sequence = getExportableSequence('seq-a')
    const main = getExportableSequence(null)

    expect(child.busAudioEq).toEqual(childEq)
    expect(sequence.busAudioEq).toEqual(sequenceEq)
    expect(main.busAudioEq).toEqual(mainEq)

    // Returned EQ data is a snapshot: later live edits do not rewrite prior exports.
    usePlaybackStore.getState().setBusAudioEq({ enabled: true, lowGainDb: 12 })
    expect(child.busAudioEq).toEqual(childEq)
    expect(sequence.busAudioEq).toEqual(sequenceEq)
    expect(main.busAudioEq).toEqual(mainEq)
  })

  it('keeps Main, child, and grandchild EQ and ranges owned by their actual composition', () => {
    const mainEq = { enabled: true, lowGainDb: 1 }
    const childEq = { enabled: true, lowGainDb: 5 }
    const grandchildEq = { enabled: true, lowGainDb: 9 }
    seedMainChildGrandchild()

    usePlaybackStore.getState().setBusAudioEq(mainEq)
    useMarkersStore.getState().setInOutPoints(2, 18)
    useCompositionNavigationStore.getState().enterComposition('child', 'child', 'child-entry')

    usePlaybackStore.getState().setBusAudioEq(childEq)
    useMarkersStore.getState().setInOutPoints(3, 15)
    useCompositionNavigationStore
      .getState()
      .enterComposition('grandchild', 'grandchild', 'grandchild-entry')

    usePlaybackStore.getState().setBusAudioEq(grandchildEq)
    useMarkersStore.getState().setInOutPoints(4, 12)

    const main = getExportableSequence(null)
    const child = getExportableSequence('child')
    const grandchild = getExportableSequence('grandchild')

    expect(main).toMatchObject({ busAudioEq: mainEq, inPoint: 2, outPoint: 18 })
    expect(child).toMatchObject({ busAudioEq: childEq, inPoint: 3, outPoint: 15 })
    expect(grandchild).toMatchObject({
      busAudioEq: grandchildEq,
      inPoint: 4,
      outPoint: 12,
    })
  })
})
