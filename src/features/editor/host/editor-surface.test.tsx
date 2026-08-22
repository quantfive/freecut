// @vitest-environment jsdom

import { useEffect } from 'react'
import { useEditorHostContext } from './context'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

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
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import type { EditorHost, EmbeddedEditorSnapshot } from './contract'

interface MockHostRuntime {
  mountStores(): void
  unmountStores(): void
}

vi.mock('@/features/editor/components/editor', () => ({
  LoadedEditor: ({
    projectId,
    hostRuntime,
  }: {
    projectId: string
    hostRuntime?: MockHostRuntime
  }) => {
    const { mode } = useEditorHostContext()
    // The real LoadedEditor owns the store lifetime for as long as the editor
    // tree is mounted; mirror it so store assertions see the host runtime.
    useEffect(() => {
      hostRuntime?.mountStores()
      return () => hostRuntime?.unmountStores()
    }, [hostRuntime])
    return (
      <div data-testid="loaded-editor">
        {mode}:{projectId}
      </div>
    )
  },
}))

import { FreeCutEditorSurface } from './editor-surface'

const fakeSnapshot: EmbeddedEditorSnapshot = {
  project: { id: 'surface-project', name: 'Surface', width: 1920, height: 1080, fps: 30 },
  timeline: {
    timelineId: 'surface-timeline',
    revision: 0,
    fps: 30,
    durationInFrames: 30,
    media: [],
    tracks: [],
    width: 1920,
    height: 1080,
  },
  assets: [],
}

/** An out-of-band revision the host pushes, e.g. after an agent run. */
const pushedSnapshot: EmbeddedEditorSnapshot = {
  ...fakeSnapshot,
  timeline: {
    ...fakeSnapshot.timeline,
    revision: 4,
    tracks: [
      {
        id: 'overlay-1',
        kind: 'overlay',
        name: 'Overlay 1',
        locked: false,
        muted: false,
        items: [
          {
            type: 'text',
            id: 'pushed-text',
            trackId: 'overlay-1',
            from: 0,
            durationInFrames: 30,
            text: 'Pushed by the host',
          },
        ],
      },
    ],
  },
}

function fakeHost(): EditorHost {
  return {
    capabilities: { 'media.resolve': true, 'workspace.edit': true },
    load: vi.fn(async () => fakeSnapshot),
    resolveMedia: vi.fn(() => null),
    submitEdit: vi.fn(() => {
      throw new Error('not used by surface mount test')
    }),
  }
}

function subscribableHost() {
  const listeners = new Set<(snapshot: EmbeddedEditorSnapshot) => void>()
  const host: EditorHost = {
    ...fakeHost(),
    subscribe: vi.fn((listener: (snapshot: EmbeddedEditorSnapshot) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  return {
    host,
    listeners,
    push(snapshot: EmbeddedEditorSnapshot) {
      act(() => {
        for (const listener of listeners) listener(snapshot)
      })
    },
  }
}

describe('FreeCut host browser surface', () => {
  it('injects a fake host into the real LoadedEditor entry', async () => {
    const host = fakeHost()
    render(<FreeCutEditorSurface host={host} />)

    await waitFor(() => expect(screen.getByTestId('loaded-editor')).toBeInTheDocument())
    expect(screen.getByTestId('loaded-editor')).toHaveTextContent('host:surface-project')
    expect(host.load).toHaveBeenCalledTimes(1)
  })

  it('applies a snapshot pushed through host.subscribe without remounting the surface', async () => {
    const harness = subscribableHost()
    const { unmount } = render(<FreeCutEditorSurface host={harness.host} />)

    await waitFor(() => expect(screen.getByTestId('loaded-editor')).toBeInTheDocument())
    expect(harness.host.subscribe).toHaveBeenCalledTimes(1)
    expect(useItemsStore.getState().items).toHaveLength(0)

    const editorBeforePush = screen.getByTestId('loaded-editor')
    harness.push(pushedSnapshot)

    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['pushed-text'])
    expect(useItemsStore.getState().tracks.map((track) => track.id)).toEqual(['overlay-1'])
    // Same DOM node and a single load(): the surface adopted the revision in
    // place instead of being torn down and rebuilt.
    expect(screen.getByTestId('loaded-editor')).toBe(editorBeforePush)
    expect(harness.host.load).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('unsubscribes from the host when the surface unmounts', async () => {
    const harness = subscribableHost()
    const { unmount } = render(<FreeCutEditorSurface host={harness.host} />)

    await waitFor(() => expect(screen.getByTestId('loaded-editor')).toBeInTheDocument())
    expect(harness.listeners.size).toBe(1)

    unmount()

    expect(harness.listeners.size).toBe(0)
  })
})
