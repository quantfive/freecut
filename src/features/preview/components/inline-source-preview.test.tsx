import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const harness = vi.hoisted(() => ({
  globalVersion: 0,
  epochs: new Map<string, number>(),
  resolveMediaUrl: vi.fn<(mediaId: string) => Promise<string>>(),
  mounts: 0,
  unmounts: 0,
  listeners: new Set<() => void>(),
  publish: () => {
    for (const listener of harness.listeners) listener()
  },
}))

vi.mock('@/features/preview/deps/player-context', () => ({
  PlayerEmitterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClockBridgeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VideoConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClock: () => ({ seekToFrame: vi.fn() }),
}))

vi.mock('@/features/preview/deps/media-library', () => ({
  useMediaLibraryStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      mediaById: {
        'media-1': {
          id: 'media-1',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
          duration: 5,
          width: 1920,
          height: 1080,
          fps: 30,
        },
      },
    }),
  getMediaType: () => 'video',
}))

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: (selector: (state: { zoom: number }) => unknown) => selector({ zoom: -1 }),
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  useBlobUrlVersion: () =>
    useSyncExternalStore(
      (listener) => {
        harness.listeners.add(listener)
        return () => harness.listeners.delete(listener)
      },
      () => harness.globalVersion,
    ),
  useBlobUrlEpoch: (mediaId: string) =>
    useSyncExternalStore(
      (listener) => {
        harness.listeners.add(listener)
        return () => harness.listeners.delete(listener)
      },
      () => String(harness.epochs.get(mediaId) ?? 0),
    ),
}))

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: harness.resolveMediaUrl,
}))

vi.mock('./source-composition', () => ({
  SourceComposition: ({ src }: { src: string }) => {
    useEffect(() => {
      harness.mounts += 1
      return () => {
        harness.unmounts += 1
      }
    }, [])
    return <div data-testid="inline-source-composition" data-source={src} />
  },
}))

import { InlineSourcePreview } from './inline-source-preview'

describe('InlineSourcePreview source binding ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.globalVersion = 0
    harness.epochs.clear()
    harness.resolveMediaUrl.mockResolvedValue('blob:media-1')
    harness.mounts = 0
    harness.unmounts = 0
    harness.listeners.clear()
  })

  it('preserves the current frame generation across unrelated blob URL activity', async () => {
    const rendered = render(
      <InlineSourcePreview
        mediaId="media-1"
        seekFrame={12}
        containerSize={{ width: 960, height: 540 }}
      />,
    )

    await waitFor(() => {
      expect(rendered.getByTestId('inline-source-composition')).toHaveAttribute(
        'data-source',
        'blob:media-1',
      )
    })
    expect(harness.resolveMediaUrl).toHaveBeenCalledTimes(1)

    act(() => {
      harness.globalVersion += 1
      harness.publish()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(harness.resolveMediaUrl).toHaveBeenCalledTimes(1)
    expect(harness.mounts).toBe(1)
    expect(harness.unmounts).toBe(0)
  })

  it('retires the relevant frame generation before resolving its replacement once', async () => {
    let resolveReplacement!: (url: string) => void
    const replacement = new Promise<string>((resolve) => {
      resolveReplacement = resolve
    })
    harness.resolveMediaUrl.mockResolvedValueOnce('blob:old').mockReturnValueOnce(replacement)
    const rendered = render(
      <InlineSourcePreview
        mediaId="media-1"
        seekFrame={12}
        containerSize={{ width: 960, height: 540 }}
      />,
    )

    await waitFor(() => {
      expect(rendered.getByTestId('inline-source-composition')).toHaveAttribute(
        'data-source',
        'blob:old',
      )
    })

    act(() => {
      harness.epochs.set('media-1', 1)
      harness.globalVersion += 1
      harness.publish()
    })

    expect(rendered.queryByTestId('inline-source-composition')).toBeNull()
    await waitFor(() => expect(harness.resolveMediaUrl).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveReplacement('blob:new')
      await replacement
    })

    expect(rendered.getByTestId('inline-source-composition')).toHaveAttribute(
      'data-source',
      'blob:new',
    )
    expect(harness.resolveMediaUrl).toHaveBeenCalledTimes(2)
    expect(harness.unmounts).toBe(1)
  })
})
