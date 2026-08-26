import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

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

const compositionRuntimeMocks = vi.hoisted(() => ({
  previewContext: null as {
    state: 'suspended' | 'running'
    resume: () => Promise<void>
  } | null,
}))

vi.mock('@/features/editor/deps/composition-runtime', () => ({
  peekSharedPreviewAudioContext: () => compositionRuntimeMocks.previewContext,
}))

import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import type { EditorHost, EmbeddedEditorSnapshot } from './contract'
import { EmbeddedEditorHostRuntime } from './runtime'

function snapshot(): EmbeddedEditorSnapshot {
  return {
    project: {
      id: 'project-1',
      name: 'Host project',
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
    },
    timeline: {
      timelineId: 'timeline-1',
      revision: 0,
      fps: 30,
      durationInFrames: 300,
      media: [
        {
          media_id: 'media-1',
          media_kind: 'video',
          content_hash: 'sha256:media-1',
          duration_us: 10_000_000,
          availability: { mode: 'cloud', cloud: { object_id: 'opaque-media-object-1' } },
        },
      ],
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          name: 'Video 1',
          locked: false,
          muted: false,
          items: [
            {
              type: 'video',
              id: 'clip-1',
              trackId: 'track-1',
              mediaId: 'media-1',
              from: 0,
              durationInFrames: 60,
              sourceStart: 0,
              sourceEnd: 60,
            },
          ],
        },
      ],
      width: 1920,
      height: 1080,
      backgroundColor: '#000000',
    },
    assets: [
      {
        id: 'media-1',
        kind: 'video',
        fileName: 'host-video.mp4',
        mimeType: 'video/mp4',
        durationSeconds: 10,
        width: 1920,
        height: 1080,
        fps: 30,
        contentHash: 'sha256:media-1',
      },
    ],
  }
}

function createHost(snap: EmbeddedEditorSnapshot): EditorHost {
  return {
    capabilities: {},
    load: () => snap,
    resolveMedia: async () => null,
    submitEdit: async () => {
      throw new Error('not used')
    },
  }
}

describe('EmbeddedEditorHostRuntime host audio', () => {
  afterEach(() => {
    compositionRuntimeMocks.previewContext = null
  })

  it('resets persisted playback mute/volume on mount', () => {
    usePlaybackStore.setState({ muted: true, volume: 0 })

    const runtime = new EmbeddedEditorHostRuntime(createHost(snapshot()), snapshot())
    try {
      runtime.mountStores()
      expect(usePlaybackStore.getState().muted).toBe(false)
      expect(usePlaybackStore.getState().volume).toBe(1)
    } finally {
      runtime.unmountStores()
    }
  })

  it('resumes a suspended preview AudioContext on every user gesture', () => {
    const resume = vi.fn(() => Promise.resolve())
    compositionRuntimeMocks.previewContext = { state: 'suspended', resume }

    const runtime = new EmbeddedEditorHostRuntime(createHost(snapshot()), snapshot())
    runtime.mountStores()
    try {
      document.dispatchEvent(new Event('pointerdown'))
      expect(resume).toHaveBeenCalledTimes(1)

      // Resilient, not one-time: a later keydown resumes again.
      document.dispatchEvent(new KeyboardEvent('keydown'))
      expect(resume).toHaveBeenCalledTimes(2)

      // A running context is left alone.
      compositionRuntimeMocks.previewContext = { state: 'running', resume }
      document.dispatchEvent(new Event('pointerdown'))
      expect(resume).toHaveBeenCalledTimes(2)
    } finally {
      runtime.unmountStores()
    }

    // Listeners are removed on unmount.
    compositionRuntimeMocks.previewContext = { state: 'suspended', resume }
    document.dispatchEvent(new Event('pointerdown'))
    expect(resume).toHaveBeenCalledTimes(2)
  })

  it('clears stale media skim overlays on mount and when playback starts', () => {
    usePlaybackStore.setState({ isPlaying: false })
    useEditorStore.getState().setMediaSkimPreview('media-1', 12)

    const runtime = new EmbeddedEditorHostRuntime(createHost(snapshot()), snapshot())
    runtime.mountStores()
    try {
      expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBeNull()

      useEditorStore.getState().setMediaSkimPreview('media-1', 18)
      usePlaybackStore.setState({ isPlaying: true })

      expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBeNull()
      expect(useEditorStore.getState().mediaSkimPreviewFrame).toBeNull()
    } finally {
      runtime.unmountStores()
    }
  })
})
