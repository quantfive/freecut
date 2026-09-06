import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { clearTimelineHover, setTimelineHover } from '../utils/timeline-hover-state'
import { useHostTimelineShortcuts, useTimelineShortcuts } from './use-timeline-shortcuts'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { EditorHostProvider, type EditorHost } from '../deps/editor'

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

function HostShortcutBindings() {
  useHostTimelineShortcuts()
  return null
}

function HostShortcutHarness({
  onRippleDelete,
  history,
  host,
}: {
  onRippleDelete?: (itemIds: readonly string[]) => void | Promise<void>
  history?: { undo: () => Promise<void> | void; redo: () => Promise<void> | void }
  host?: EditorHost
}) {
  if (!onRippleDelete && !history && !host) return <HostShortcutBindings />
  const hostValue =
    host ??
    ({
      capabilities: {},
      load: vi.fn(),
      resolveMedia: vi.fn(),
      submitEdit: vi.fn(),
      history,
    } as unknown as EditorHost)
  return (
    <EditorHostProvider
      value={{
        mode: 'host',
        capabilities: { 'timeline.remove': true },
        host: hostValue,
        timeline: { requestRippleDelete: onRippleDelete ?? vi.fn() },
      }}
    >
      <HostShortcutBindings />
    </EditorHostProvider>
  )
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

  afterEach(() => {
    document.body.replaceChildren()
  })

  function focusedClipTarget(): HTMLDivElement {
    const target = document.createElement('div')
    target.dataset.timelineItem = ''
    target.dataset.itemId = ITEM.id
    target.setAttribute('role', 'button')
    target.tabIndex = 0
    document.body.append(target)
    return target
  }

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

  it('requests authoritative ripple deletion without mutating the local timeline', () => {
    const requestRippleDelete = vi.fn(() => Promise.resolve())
    useSelectionStore.setState({ selectedItemIds: ['clip-1'], selectionType: 'item' })
    render(<HostShortcutHarness onRippleDelete={requestRippleDelete} />)

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })

    expect(requestRippleDelete).toHaveBeenCalledWith(['clip-1'])
    expect(useTimelineStore.getState().items).toEqual([ITEM])
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

  it.each([
    ['Ctrl+Z', { ctrlKey: true }],
    ['Meta+Z', { metaKey: true }],
  ] as const)('routes %s from a focused clip through host history', async (_name, modifier) => {
    const undo = vi.fn(async () => undefined)
    const redo = vi.fn(async () => undefined)
    const target = focusedClipTarget()
    useTimelineStore.getState().moveItem('clip-1', 30)
    render(<HostShortcutHarness history={{ undo, redo }} />)

    fireEvent.keyDown(target, { key: 'z', code: 'KeyZ', ...modifier })
    await Promise.resolve()

    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()
    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 30 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('routes Shift+Meta+Z from a focused clip through host redo', async () => {
    const undo = vi.fn(async () => undefined)
    const redo = vi.fn(async () => undefined)
    const target = focusedClipTarget()
    useTimelineStore.getState().moveItem('clip-1', 30)
    render(<HostShortcutHarness history={{ undo, redo }} />)

    fireEvent.keyDown(target, { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true })
    await Promise.resolve()

    expect(redo).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 30 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it('notifies when a host history action rejects without an unhandled rejection', async () => {
    const notify = vi.fn()
    const undo = vi.fn(async () => {
      throw new Error('history unavailable')
    })
    const redo = vi.fn(async () => undefined)
    const target = focusedClipTarget()
    const host = {
      capabilities: {},
      load: vi.fn(),
      resolveMedia: vi.fn(),
      submitEdit: vi.fn(),
      history: { undo, redo },
      notify,
    } as unknown as EditorHost
    render(<HostShortcutHarness host={host} />)

    fireEvent.keyDown(target, { key: 'z', code: 'KeyZ', metaKey: true })
    await Promise.resolve()
    await Promise.resolve()

    expect(undo).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ kind: 'error', message: 'Host undo failed' })
  })

  it('does nothing in host mode when the history port is missing', () => {
    const target = focusedClipTarget()
    useTimelineStore.getState().moveItem('clip-1', 30)
    const host = {
      capabilities: {},
      load: vi.fn(),
      resolveMedia: vi.fn(),
      submitEdit: vi.fn(),
    } as unknown as EditorHost
    render(<HostShortcutHarness host={host} />)

    fireEvent.keyDown(target, { key: 'z', code: 'KeyZ', metaKey: true })

    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 30 })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
  })

  it.each([
    [
      'editable clip',
      () => {
        const target = focusedClipTarget()
        target.setAttribute('contenteditable', 'true')
        return target
      },
    ],
    [
      'nested control',
      () => {
        const target = focusedClipTarget()
        const button = document.createElement('button')
        button.textContent = 'Nested'
        target.append(button)
        return button
      },
    ],
    [
      'dialog clip',
      () => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        document.body.append(dialog)
        const target = document.createElement('div')
        target.dataset.timelineItem = ''
        target.dataset.itemId = ITEM.id
        target.setAttribute('role', 'button')
        dialog.append(target)
        return target
      },
    ],
  ] as const)('protects %s from host history shortcuts', (_name, createTarget) => {
    const undo = vi.fn(async () => undefined)
    const redo = vi.fn(async () => undefined)
    const target = createTarget()
    render(<HostShortcutHarness history={{ undo, redo }} />)

    fireEvent.keyDown(target, { key: 'z', code: 'KeyZ', metaKey: true })

    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })

  it('still undoes on Mod+Z with the full timeline shortcuts (control)', () => {
    useTimelineStore.getState().moveItem('clip-1', 30)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    render(<FullShortcutHarness />)

    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', metaKey: true })

    expect(useTimelineStore.getState().items[0]).toMatchObject({ id: 'clip-1', from: 0 })
  })
})
