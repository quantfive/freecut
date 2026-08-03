// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { shouldEnableHtmlInCanvasPlayback, supportsHtmlInCanvas } from './html-in-canvas'

describe('supportsHtmlInCanvas', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    delete (HTMLCanvasElement.prototype as HTMLCanvasElement & { layoutSubtree?: boolean })
      .layoutSubtree
    delete (HTMLCanvasElement.prototype as HTMLCanvasElement & { requestPaint?: () => void })
      .requestPaint
    vi.restoreAllMocks()
  })

  it('accepts only the complete experimental canvas contract', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'layoutSubtree', {
      configurable: true,
      writable: true,
      value: false,
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'requestPaint', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawElementImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    expect(supportsHtmlInCanvas()).toBe(true)
  })

  it('rejects partial implementations', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'layoutSubtree', {
      configurable: true,
      writable: true,
      value: false,
    })
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawElementImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    expect(supportsHtmlInCanvas()).toBe(false)
  })
})

describe('shouldEnableHtmlInCanvasPlayback', () => {
  const eligible = {
    fastRendererEnabled: true,
    domTextOverlayEnabled: true,
    comparisonEnabled: false,
    htmlInCanvasSupported: true,
  }

  it('enables canvas-owned playback only for supported DOM-text previews', () => {
    expect(shouldEnableHtmlInCanvasPlayback(eligible)).toBe(true)
    expect(shouldEnableHtmlInCanvasPlayback({ ...eligible, domTextOverlayEnabled: false })).toBe(
      false,
    )
    expect(
      shouldEnableHtmlInCanvasPlayback({ ...eligible, htmlInCanvasSupported: false }),
    ).toBe(false)
    expect(shouldEnableHtmlInCanvasPlayback({ ...eligible, comparisonEnabled: true })).toBe(false)
  })
})
