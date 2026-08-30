// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import { isTimelinePointerControl, resolveTimelinePointerFrame } from './timeline-pointer'

describe('timeline pointer intent', () => {
  it('resolves a background click from its pointer coordinate instead of preview state', () => {
    const container = {
      getBoundingClientRect: () => ({ left: 100 }),
      scrollLeft: 20,
    } as HTMLDivElement

    expect(
      resolveTimelinePointerFrame({
        clientX: 180,
        container,
        pixelsToFrame: (pixels) => pixels / 2,
        maxTimelineFrame: 200,
        fallbackFrame: 7,
      }),
    ).toBe(50)
  })

  it.each([
    ['trim handle', 'data-trim-handle', 'start'],
    ['fade control', 'data-clip-fade-controls', 'video'],
    ['context anchor', 'data-item-context-anchor', ''],
    ['scrollbar', 'role', 'scrollbar'],
    ['menu', 'role', 'menu'],
  ])('recognizes %s as a non-seeking control', (_name, attribute, value) => {
    const target = document.createElement('button')
    target.setAttribute(attribute, value)

    expect(isTimelinePointerControl(target)).toBe(true)
  })

  it('allows an ordinary track background target to seek', () => {
    const track = document.createElement('div')
    track.dataset.trackId = 'track-1'

    expect(isTimelinePointerControl(track)).toBe(false)
  })
})
