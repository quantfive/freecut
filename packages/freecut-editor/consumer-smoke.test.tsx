// @vitest-environment jsdom

import '@testing-library/jest-dom'
import '@quantfive/freecut-editor-surface/style.css'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import {
  FreeCutEditorSurface,
  capabilityForCommand,
  isHostCapabilityEnabled,
  type EditorHost,
  type EmbeddedEditorSnapshot,
} from '@quantfive/freecut-editor-surface'

const snapshot: EmbeddedEditorSnapshot = {
  project: {
    id: 'consumer-smoke-project',
    name: 'Consumer smoke project',
    width: 1920,
    height: 1080,
    fps: 30,
  },
  timeline: {
    timelineId: 'consumer-smoke-timeline',
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

function fakeHost(): EditorHost {
  return {
    capabilities: {
      'media.resolve': true,
      'timeline.add': false,
    },
    load: vi.fn(() => snapshot),
    resolveMedia: vi.fn(() => null),
    submitEdit: vi.fn(() => {
      throw new Error('consumer smoke does not submit an edit')
    }),
  }
}

beforeAll(() => {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, {
    ResizeObserver: TestResizeObserver,
    requestIdleCallback: (callback: IdleRequestCallback) =>
      setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
    cancelIdleCallback: (id: number) => clearTimeout(id),
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('published FreeCut browser entry', () => {
  it('imports the package entry, mounts the real editor surfaces, and keeps host capability gates bounded', async () => {
    const host = fakeHost()
    render(<FreeCutEditorSurface host={host} />)

    await waitFor(
      () => {
        expect(screen.getAllByRole('toolbar').length).toBeGreaterThanOrEqual(2)
        expect(screen.getByRole('region', { name: 'Preview area' })).toBeInTheDocument()
        expect(screen.getByText('Timeline')).toBeInTheDocument()
      },
      { timeout: 10_000 },
    )

    expect(screen.getByTestId('properties-clip-panel-host')).toBeInTheDocument()
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(capabilityForCommand('move_item')).toBe('timeline.move')
    expect(isHostCapabilityEnabled(host.capabilities, 'timeline.add')).toBe(false)
  })
})
