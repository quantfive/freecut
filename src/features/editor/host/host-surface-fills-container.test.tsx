// @vitest-environment jsdom

// The embedded surface must FILL the box its host hands it. CodePress, for one,
// renders the surface inside `<main class="h-[calc(100dvh-73px)] overflow-y-auto">`
// — the viewport minus its own fixed app header. Any element in the surface's
// layout chain that sizes itself against the viewport instead (`h-screen`,
// `min-h-screen`, `h-[100vh]`, …) overflows that box by exactly the header
// height, and the host's `overflow-y-auto` turns the overflow into a scrollbar.
//
// jsdom does no layout, so this asserts the cause rather than measuring the
// symptom: it mounts the REAL surface tree and fails if any in-flow element
// claims viewport height. The measured version lives in the browser check
// described in the fix's PR — this is the cheap regression guard.

import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { FreeCutEditorSurface } from './editor-surface'
import type { EditorHost, EmbeddedEditorSnapshot } from './contract'

/**
 * Tailwind height classes that resolve against the viewport rather than the
 * parent. `max-h-*` is deliberately excluded: a max clamps, it cannot make an
 * element taller than its container.
 */
const VIEWPORT_HEIGHT_CLASS = /^(?:min-)?h-(?:screen|dvh|svh|lvh|\[[^\]]*(?:vh|dvh|svh|lvh)\])$/

function viewportHeightOffenders(root: ParentNode): string[] {
  const offenders: string[] = []
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    const claimed = Array.from(element.classList).filter((name) => VIEWPORT_HEIGHT_CLASS.test(name))
    if (claimed.length > 0) {
      offenders.push(`${element.tagName.toLowerCase()}.${claimed.join('.')}`)
    }
  }
  return offenders
}

const snapshot: EmbeddedEditorSnapshot = {
  project: { id: 'bounded-host-project', name: 'Bounded host', width: 1920, height: 1080, fps: 30 },
  timeline: {
    timelineId: 'bounded-host-timeline',
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
    capabilities: { 'media.resolve': true },
    load: vi.fn(() => snapshot),
    resolveMedia: vi.fn(() => null),
    submitEdit: vi.fn(() => {
      throw new Error('this test never submits an edit')
    }),
  }
}

beforeAll(() => {
  Object.assign(globalThis, {
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

describe('embedded host surface sizing', () => {
  it('fills its host container instead of claiming the viewport', async () => {
    render(<FreeCutEditorSurface host={fakeHost()} />)

    await waitFor(() => expect(screen.getByRole('application')).toBeInTheDocument(), {
      timeout: 10_000,
    })

    expect(viewportHeightOffenders(document.body)).toEqual([])
    expect(document.querySelector('[data-freecut-editor-surface="host"]')).toHaveClass('h-full')
    expect(screen.getByRole('application')).toHaveClass('h-full')
  })

  // The placeholders the surface shows before `host.load()` settles are in the
  // same container, so they have to fit it too.
  it('keeps the pre-load placeholder inside the host container', () => {
    render(<FreeCutEditorSurface host={{ ...fakeHost(), load: () => new Promise(() => {}) }} />)

    expect(screen.getByText('Loading editor…')).toBeInTheDocument()
    expect(viewportHeightOffenders(document.body)).toEqual([])
  })
})
