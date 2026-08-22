import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const previewGraphMocks = vi.hoisted(() => {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const graph = {
    context: {
      state: 'running' as AudioContextState,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => sourceNode),
    },
    sourceInputNode: {},
    outputGainNode: { gain: { value: 1 } },
    eqStageNodes: [],
    dispose: vi.fn(),
  }
  return {
    graph,
    sourceNode,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
    setPreviewClipEq: vi.fn(),
    setPreviewClipGain: vi.fn(),
  }
})

vi.mock('../utils/preview-audio-graph', () => ({
  createPreviewClipAudioGraph: previewGraphMocks.createPreviewClipAudioGraph,
  rampPreviewClipEq: previewGraphMocks.rampPreviewClipEq,
  rampPreviewClipGain: previewGraphMocks.rampPreviewClipGain,
  setPreviewClipEq: previewGraphMocks.setPreviewClipEq,
  setPreviewClipGain: previewGraphMocks.setPreviewClipGain,
}))

import { applyVideoElementAudioState } from './video-audio-context'

function createVideoElement(src: string): HTMLVideoElement {
  const element = document.createElement('video')
  element.src = src
  return element
}

describe('applyVideoElementAudioState media-origin routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    previewGraphMocks.graph.context.state = 'running'
  })

  it('routes cross-origin sources direct to element.volume without the Web Audio graph', () => {
    const video = createVideoElement('https://cdn.example.com/x.mp4')

    applyVideoElementAudioState(video, 0.8, [])

    expect(previewGraphMocks.createPreviewClipAudioGraph).not.toHaveBeenCalled()
    expect(previewGraphMocks.graph.context.createMediaElementSource).not.toHaveBeenCalled()
    expect(video.volume).toBeCloseTo(0.8)
    expect(video.muted).toBe(false)

    // Subsequent volume changes propagate through the same direct path.
    applyVideoElementAudioState(video, 0.35, [])
    expect(video.volume).toBeCloseTo(0.35)

    // Muted playback maps to a zeroed element volume.
    applyVideoElementAudioState(video, 0, [])
    expect(video.volume).toBe(0)
    expect(previewGraphMocks.graph.context.createMediaElementSource).not.toHaveBeenCalled()
  })

  it('keeps same-origin sources on the Web Audio graph', () => {
    const video = createVideoElement(`${location.origin}/media/clip.mp4`)

    applyVideoElementAudioState(video, 0.8, [])

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalledWith(video)
    expect(previewGraphMocks.sourceNode.connect).toHaveBeenCalledWith(
      previewGraphMocks.graph.sourceInputNode,
    )
    expect(previewGraphMocks.rampPreviewClipGain).toHaveBeenCalled()
    expect(video.volume).toBe(1)
  })

  it('keeps blob: sources on the Web Audio graph', () => {
    const video = createVideoElement('blob:http://localhost:3000/uuid-1')

    applyVideoElementAudioState(video, 1, [])

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalledWith(video)
  })
})
