// @vitest-environment jsdom

import { createRef, useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

// Some machines run jsdom with an opaque origin, leaving localStorage
// undefined; the editor store reads it at creation (import time).  Install a
// stub before imports evaluate — a no-op wherever the environment provides a
// real localStorage (e.g. CI).
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

// Host module tabs render inside the real MediaSidebar; the media library
// grid is unrelated to the module lifecycle and stays stubbed out.
vi.mock('@/features/editor/deps/media-library', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/editor/deps/media-library')>()
  return {
    ...original,
    MediaLibrary: () => <div data-testid="media-library-stub" />,
  }
})

interface MockHostRuntime {
  mountStores(): void
  unmountStores(): void
}

// The surface mounts LoadedEditor, which owns the host store lifetime.  The
// apiRef test mirrors that with the real MediaSidebar so the imperative open
// is observed through the same rail/panel the host sees.
vi.mock('@/features/editor/components/editor', async () => {
  const { MediaSidebar } = await import('@/features/editor/components/media-sidebar')
  return {
    LoadedEditor: ({ hostRuntime }: { hostRuntime?: MockHostRuntime }) => {
      useEffect(() => {
        hostRuntime?.mountStores()
        return () => hostRuntime?.unmountStores()
      }, [hostRuntime])
      return <MediaSidebar />
    },
  }
})

import { useEditorStore } from '@/shared/state/editor'
import { MediaSidebar } from '../components/media-sidebar'
import { EditorHostProvider } from './context-provider'
import {
  DEFAULT_HOST_CAPABILITIES,
  type EditorHost,
  type EditorSidebarModule,
  type EmbeddedEditorSnapshot,
} from './contract'
import { EmbeddedEditorHostRuntime } from './runtime'
import { FreeCutEditorSurface, type FreeCutEditorSurfaceApi } from './editor-surface'

function snapshot(): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'host-modules-project',
      name: 'Host modules project',
      width: 1920,
      height: 1080,
      fps: 30,
    },
    timeline: {
      timelineId: 'host-modules-timeline',
      revision: 0,
      fps: 30,
      durationInFrames: 300,
      media: [],
      tracks: [],
      width: 1920,
      height: 1080,
    },
    assets: [],
  }
}

function TranscribeIcon({ className }: { className?: string }) {
  return <svg className={className} data-testid="host-module-icon" />
}

function TranscribePanel({ active }: { active: boolean }) {
  return (
    <div data-testid="host-module-panel" data-active={String(active)}>
      Host transcribe panel body
    </div>
  )
}

const transcribeModule: EditorSidebarModule = {
  id: 'transcribe',
  label: 'Transcribe',
  icon: TranscribeIcon,
  Panel: TranscribePanel,
}

function createHarness(
  initial: EmbeddedEditorSnapshot,
  sidebarModules?: readonly EditorSidebarModule[],
) {
  const host: EditorHost = {
    capabilities: { ...DEFAULT_HOST_CAPABILITIES },
    load: () => initial,
    resolveMedia: () => null,
    submitEdit: vi.fn(async () => {
      throw new Error('not used by sidebar module tests')
    }),
    ...(sidebarModules ? { sidebarModules } : {}),
  }
  return {
    host,
    runtime: new EmbeddedEditorHostRuntime(host, initial),
  }
}

function renderRealSidebar(harness: ReturnType<typeof createHarness>) {
  harness.runtime.mountStores()
  return render(
    <EditorHostProvider
      value={{ mode: 'host', capabilities: harness.host.capabilities, host: harness.host }}
    >
      <MediaSidebar />
    </EditorHostProvider>,
  )
}

afterEach(() => {
  cleanup()
  useEditorStore.setState({ activeTab: 'media', leftSidebarOpen: true })
})

describe('host sidebar modules (real MediaSidebar path)', () => {
  it('shows a registered host module in the rail and renders its panel', async () => {
    const harness = createHarness(snapshot(), [transcribeModule])
    try {
      const { container } = renderRealSidebar(harness)

      expect(container.querySelector('button[data-tooltip="Transcribe"]')).not.toBeNull()
      // The panel mounts on first activation, not before.
      expect(screen.queryByTestId('host-module-panel')).not.toBeInTheDocument()

      act(() => {
        useEditorStore.getState().setActiveTab('host:transcribe')
      })

      const panel = await screen.findByTestId('host-module-panel')
      expect(panel).toHaveAttribute('data-active', 'true')
      // The panel header falls back to the host-owned label.
      expect(screen.getByText('Transcribe')).toBeInTheDocument()

      // Switching tabs keeps the panel mounted (hidden) so in-flight host
      // work survives the user browsing other tabs.
      act(() => {
        useEditorStore.getState().setActiveTab('media')
      })
      const latched = screen.getByTestId('host-module-panel')
      expect(latched).toHaveAttribute('data-active', 'false')
      expect(latched.parentElement).toHaveClass('hidden')
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('keeps a registered host: tab across authoritative snapshot installs', async () => {
    const harness = createHarness(snapshot(), [transcribeModule])
    try {
      renderRealSidebar(harness)
      act(() => {
        useEditorStore.getState().setActiveTab('host:transcribe')
      })
      expect(await screen.findByTestId('host-module-panel')).toBeInTheDocument()

      const initial = snapshot()
      act(() => {
        harness.runtime.controller.replaceAuthoritativeSnapshot({
          ...initial,
          timeline: { ...initial.timeline, revision: 1 },
        })
      })

      // Installing the authoritative snapshot must not reset the rail or
      // unmount the host panel.
      expect(useEditorStore.getState().activeTab).toBe('host:transcribe')
      expect(screen.getByTestId('host-module-panel')).toBeInTheDocument()
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('resets an unregistered host: tab to media on snapshot install', () => {
    const harness = createHarness(snapshot(), [transcribeModule])
    try {
      renderRealSidebar(harness)
      act(() => {
        useEditorStore.getState().setActiveTab('host:unknown')
      })
      const initial = snapshot()
      act(() => {
        harness.runtime.controller.replaceAuthoritativeSnapshot({
          ...initial,
          timeline: { ...initial.timeline, revision: 1 },
        })
      })
      expect(useEditorStore.getState().activeTab).toBe('media')
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('leaves the rail unchanged for hosts without sidebarModules', () => {
    const harness = createHarness(snapshot())
    try {
      const { container } = renderRealSidebar(harness)
      // The category icon rail is the only `py-1.5` flex column in the bar.
      const rail = container.querySelector('div.flex.flex-col.gap-1.py-1\\.5')
      expect(rail).not.toBeNull()
      // Host mode shows media (+ text via timeline.add) and no host entries.
      expect(rail!.querySelectorAll('button')).toHaveLength(2)
      expect(container.querySelector('button[data-tooltip="Transcribe"]')).toBeNull()
    } finally {
      harness.runtime.unmountStores()
    }
  })

  it('opens and closes a registered module through the surface apiRef', async () => {
    const harness = createHarness(snapshot(), [transcribeModule])
    const apiRef = createRef<FreeCutEditorSurfaceApi>()
    render(<FreeCutEditorSurface host={harness.host} apiRef={apiRef} />)

    await waitFor(() => expect(apiRef.current).not.toBeNull())
    expect(screen.queryByTestId('host-module-panel')).not.toBeInTheDocument()

    // Unregistered ids fail closed.
    act(() => {
      apiRef.current!.openSidebarModule('unknown')
    })
    expect(useEditorStore.getState().activeTab).toBe('media')

    // Opening a module selects its tab and reopens a closed sidebar.
    act(() => {
      useEditorStore.getState().toggleLeftSidebar()
    })
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false)
    act(() => {
      apiRef.current!.openSidebarModule('transcribe')
    })
    expect(useEditorStore.getState().activeTab).toBe('host:transcribe')
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true)
    expect(await screen.findByTestId('host-module-panel')).toBeInTheDocument()

    act(() => {
      apiRef.current!.closeSidebar()
    })
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false)
    // The latched panel stays mounted after the sidebar closes.
    expect(screen.getByTestId('host-module-panel')).toBeInTheDocument()
  })
})
