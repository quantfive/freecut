import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { clearTimelineHover, setTimelineHover } from '../utils/timeline-hover-state'
import { useHostTimelineShortcuts, useTimelineShortcuts } from './use-timeline-shortcuts'
import type { TimelineTrack, VideoItem } from '@/types/timeline'

// Some machines run jsdom with an opaque origin, leaving localStorage
// undefined; the zustand persist middleware captures it at store creation
// (import time).  Install a stub before imports evaluate — a no-op wherever
// the environment provides a real localStorage (e.g. CI).
vi.hoisted(() => {
  if (typeof globalThis.localStorage !== 'undefined') return
  const backing = new Map<string, string>()
  const stub: Storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true })
})

function HostShortcutHarness() {
  useHostTimelineShortcuts()
  return null
}

function FullShortcutHarness() {
  useTimelineShortcuts()
  return null
}

const TRACK: TimelineTrack = {
  id: 'track-1',
  name: 'V1',
  kind: 'video',
  order: 0,
  height: 80,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
}

const ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Clip 1',
  src: 'clip.mp4',
}

describe('useHostTimelineShortcuts', () => {
  beforeEach(() => {
    clearTimelineHover()
    useTimelineCommandStore.getState().clearHistory()
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectionType: null,
      editKeyframePanelOpen: false,
      expandedKeyframeLanes: new Set(),
    })
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [],
      clipboard: null,
      isCut: false,
    })
    useEditorStore.setState({
      keyframeEditorShortcutScopeActive: false,
      transcriptEditorShortcutScopeActive: false,
    })
    usePlaybackStore.setState({
      isPlaying: false,
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
    })
    useTimelineStore.setState({
      tracks: [TRACK],
      items: [ITEM],
      transitions: [],
      keyframes: [],
      markers: [],
    })
  })

  it('toggles playback on Space', () => {
    render(<HostShortcutHarness />)

    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    fireEvent.keyDown(document, { key: ' ', code: 'Space' })
    expect(usePlaybackStore.getState().isPlaying).toBe(true)
    fireEvent.keyDown(document, { key: ' ', code: 'Space' })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
  })

  it('removes the selected item on Delete', () => {
    useSelectionStore.setState({ selectedItemIds: ['clip-1'], selectionType: 'item' })
    render(<HostShortcutHarness />)

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })

    expect(useTimelineStore.getState().items).toHaveLength(0)
  })

  it('removes multiple selected items on Delete', () => {
    const clip2: VideoItem = { ...ITEM, id: 'clip-2', from: 30 }
    useTimelineStore.setState({ items: [ITEM, clip2] })
    useSelectionStore.setState({
      selectedItemIds: ['clip-1', 'clip-2'],
      selectionType: 'item',
    })
    render(<HostShortcutHarness />)

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })

    expect(useTimelineStore.getState().items).toHaveLength(0)
  })

  it('splits the hovered clip at the pointer frame on C', () => {
    usePlaybackStore.setState({
      currentFrame: 4,
      previewFrame: null,
      previewItemId: null,
    })
    setTimelineHover('clip-1', 15)
    render(<HostShortcutHarness />)

    fireEvent.keyDown(document, { key: 'c', code: 'KeyC' })

    expect(useTimelineStore.getState().items).toHaveLength(2)
    expect(useTimelineStore.getState().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'clip-1', from: 0, durationInFrames: 15 }),
        expect.objectContaining({ from: 15, durationInFrames: 15 }),
      ]),
    )
  })

  it('does not undo timeline edits on Mod+Z in host mode', () => {
    useTimelineStore.getState().moveItem('clip-1', 30)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    render(<HostShortcutHarness />)

    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', metaKey: true })

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 30 })
  })

  it('still undoes on Mod+Z with the full timeline shortcuts (control)', () => {
    useTimelineStore.getState().moveItem('clip-1', 30)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    render(<FullShortcutHarness />)

    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', metaKey: true })

    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 0 })
  })
})
