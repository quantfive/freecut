// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import {
  createRenderedPlaybackDiagnostics,
  publishRenderedPlaybackDiagnostics,
} from './rendered-playback-diagnostics'

describe('rendered playback diagnostics', () => {
  it('separates display cadence, clock cadence, presentation, and render cost', () => {
    const diagnostics = createRenderedPlaybackDiagnostics()
    diagnostics.start(100)
    for (let index = 0; index < 61; index += 1) diagnostics.recordRaf(100 + index * 10)
    for (let frame = 0; frame < 30; frame += 1) diagnostics.recordClockFrame()
    for (let frame = 0; frame < 24; frame += 1) diagnostics.recordPresentation(frame)
    for (const renderMs of [2, 4, 6, 8, 10]) diagnostics.recordRender(renderMs)
    diagnostics.stop(1100)

    const snapshot = diagnostics.snapshot()
    expect(snapshot.rafFps).toBe(100)
    expect(snapshot.clockFps).toBe(30)
    expect(snapshot.presentedFps).toBe(24)
    expect(snapshot.p50RenderMs).toBe(6)
    expect(snapshot.p95RenderMs).toBe(10)

    const canvas = document.createElement('canvas')
    publishRenderedPlaybackDiagnostics(canvas, snapshot)
    expect(canvas.dataset.renderedPlaybackPresentedFps).toBe('24.0')
    expect(canvas.dataset.renderedPlaybackP95RenderMs).toBe('10.000')
  })
})
