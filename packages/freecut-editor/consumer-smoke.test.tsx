// @vitest-environment jsdom
/// <reference path="./consumer-smoke-style.d.ts" />

import '@testing-library/jest-dom'
import '@quantfive/freecut-editor-surface/style.css'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import {
  FreeCutEditorSurface,
  HOTKEYS,
  capabilityForCommand,
  createHostShortcutSettings,
  isHostCapabilityEnabled,
  type EditorHost,
  type EditorTranscriptPort,
  type EmbeddedEditorSnapshot,
  type HostEditPredicate,
  type HostNotice,
  type HostTimelineEditPort,
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
    subscribe: vi.fn(() => () => undefined),
    shortcuts: {
      getSettings: () =>
        createHostShortcutSettings({
          SHUTTLE_REVERSE: 'q',
          SHUTTLE_PAUSE: 'w',
          SHUTTLE_FORWARD: 'e',
        }),
      setSettings: vi.fn(),
    },
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

/**
 * Tailwind height classes that resolve against the viewport rather than the
 * parent. The published surface is embedded inside host chrome, so a single one
 * of these anywhere in its layout chain overflows the host's container by
 * exactly the height of that chrome. `max-h-*` is excluded on purpose: a max
 * clamps, it cannot make an element taller than its container.
 */
const VIEWPORT_HEIGHT_CLASS = /^(?:min-)?h-(?:screen|dvh|svh|lvh|\[[^\]]*(?:vh|dvh|svh|lvh)\])$/

function viewportHeightOffenders(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*'))
    .map((element) => ({
      element,
      claimed: Array.from(element.classList).filter((name) => VIEWPORT_HEIGHT_CLASS.test(name)),
    }))
    .filter(({ claimed }) => claimed.length > 0)
    .map(({ element, claimed }) => `${element.tagName.toLowerCase()}.${claimed.join('.')}`)
}

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
    expect(await screen.findByTestId('caption-editor')).toBeInTheDocument()
    expect(HOTKEYS).toMatchObject({
      SHUTTLE_REVERSE: 'j',
      SHUTTLE_PAUSE: 'k',
      SHUTTLE_FORWARD: 'l',
      EDIT_KEYFRAME_ADD: 'shift+k',
    })
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.subscribe).toHaveBeenCalledTimes(1)
    expect(capabilityForCommand('move_item')).toBe('timeline.move')
    expect(capabilityForCommand('ripple_delete')).toBe('timeline.remove')
    expect(capabilityForCommand('set_caption_style')).toBe('timeline.caption')
    expect(isHostCapabilityEnabled(host.capabilities, 'timeline.add')).toBe(false)

    const predicate: HostEditPredicate = 'sourceRange'
    const notice: HostNotice = {
      kind: 'unsupported',
      message: 'Unsupported edit',
      detail: { code: 'ambiguous_change', failedPredicates: [predicate] },
    }
    const requestTranscription = vi.fn<NonNullable<EditorTranscriptPort['requestTranscription']>>()
    const timelinePort: HostTimelineEditPort = { requestRippleDelete: vi.fn() }
    expect(notice.detail?.failedPredicates).toEqual(['sourceRange'])
    expect(requestTranscription).toBeTypeOf('function')
    expect(timelinePort.requestRippleDelete).toBeTypeOf('function')
  })

  it('sizes the published surface against its container, never the viewport', async () => {
    const { container } = render(<FreeCutEditorSurface host={fakeHost()} />)

    await waitFor(() => expect(container.querySelector('[role="application"]')).not.toBeNull(), {
      timeout: 10_000,
    })

    expect(viewportHeightOffenders(container)).toEqual([])
    expect(container.querySelector('[data-freecut-editor-surface="host"]')).toHaveClass('h-full')
    expect(container.querySelector('[role="application"]')).toHaveClass('h-full')
  })
})
