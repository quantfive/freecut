import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq'

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}))
const clockRateMocks = vi.hoisted(() => ({ current: 1 }))

vi.mock('@/runtime/composition-runtime/deps/player', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/composition-runtime/deps/player')>()),
  useClockPlaybackRate: () => clockRateMocks.current,
}))

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [] as (typeof DEFAULT_AUDIO_EQ_SETTINGS)[],
  } as {
    frame: number
    fps: number
    playing: boolean
    transportPlaybackRate?: number
    isPreviewScrubbing?: boolean
    resolvedVolume: number
    resolvedPitchShiftSemitones: number
    resolvedAudioEqStages: (typeof DEFAULT_AUDIO_EQ_SETTINGS)[]
  },
}))

const previewAudioMocks = vi.hoisted(() => {
  const state: { current: HTMLAudioElement | null } = { current: null }
  const createAudio = () =>
    ({
      volume: 1,
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      readyState: 4,
      paused: true,
      seeking: false,
      play: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = false
        return Promise.resolve()
      }),
      pause: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = true
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLAudioElement

  return {
    state,
    acquirePreviewAudioElement: vi.fn(() => {
      const audio = createAudio()
      state.current = audio
      return audio
    }),
    releasePreviewAudioElement: vi.fn(),
    markPreviewAudioElementUsesWebAudio: vi.fn(),
  }
})

const previewGraphMocks = vi.hoisted(() => {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  const graph = {
    context: {
      state: 'running' as const,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => sourceNode),
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  }

  return {
    graph,
    sourceNode,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
    setPreviewClipGain: vi.fn(),
  }
})

const playbackStoreState = vi.hoisted(() => ({
  current: { isPlaying: false, previewFrame: null as number | null },
}))

const storeMocks = vi.hoisted(() => {
  const gizmoState = { activeGizmo: null, preview: null }
  const useGizmoStore = Object.assign(
    vi.fn((selector?: (state: typeof gizmoState) => unknown) =>
      selector ? selector(gizmoState) : gizmoState,
    ),
    {
      getState: () => gizmoState,
    },
  )

  return {
    useGizmoStore,
    usePlaybackStore: {
      getState: () => playbackStoreState.current,
    },
  }
})

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks)
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('../utils/preview-audio-element-pool', () => previewAudioMocks)
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks)
vi.mock('@/runtime/composition-runtime/deps/stores', () => storeMocks)
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
  }: {
    audioBuffer: AudioBuffer
    sourceStartOffsetSec?: number
  }) => (
    <div
      data-testid="pitch"
      data-frames={audioBuffer.length}
      data-offset={sourceStartOffsetSec ?? 0}
    />
  ),
}))

import { PitchCorrectedAudio } from './pitch-corrected-audio'

function makeAudioBuffer(durationSeconds = 8): AudioBuffer {
  const sampleRate = 22050
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('PitchCorrectedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
  })

  it('keeps 1x playback on the native preview path', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledWith('blob:audio')
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull()
  })

  it('keeps the native preview graph alive while EQ stages change', async () => {
    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      resolvedAudioEqStages: [DEFAULT_AUDIO_EQ_SETTINGS],
    }

    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(
        previewGraphMocks.graph,
        [DEFAULT_AUDIO_EQ_SETTINGS],
      )
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledTimes(1)
  })

  it('uses playback-first decode for stretched clips with media ids', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 4,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
          targetTimeSeconds: 4,
        },
      )
    })

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-frames',
        String(22050 * 2),
      )
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4')
    })

    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
  })

  it('defers decoded pitch audio until an active preview scrub settles', async () => {
    playbackStateMocks.current.isPreviewScrubbing = true
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
      />,
    )

    await Promise.resolve()
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()

    playbackStateMocks.current.isPreviewScrubbing = false
    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
      expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    })
  })

  it('uses a synthetic decode key when pitch correction is needed without a media id', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.25}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'legacy-src:blob:audio',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
        }),
      )
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses the decoded path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={4}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses a reverse-ready decoded window for transient reverse shuttle', async () => {
    clockRateMocks.current = -4
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      playing: true,
      transportPlaybackRate: -4,
    }
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(6),
      startTime: 6,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="nested-audio-1"
        durationInFrames={600}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    const reverseOptions = audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]
    expect(reverseOptions?.targetTimeSeconds).toBeCloseTo(10, 4)
    expect(reverseOptions?.preRollSeconds).toBe(4)
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })
})

describe('PitchCorrectedAudio cross-origin media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
  })

  it('drives the element directly instead of the silenced Web Audio path', async () => {
    const { rerender } = render(
      <PitchCorrectedAudio
        src="https://cdn.example.com/a.mp3"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledWith(
        'https://cdn.example.com/a.mp3',
      )
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).not.toHaveBeenCalled()
    expect(previewGraphMocks.graph.context.createMediaElementSource).not.toHaveBeenCalled()
    expect(previewAudioMocks.markPreviewAudioElementUsesWebAudio).not.toHaveBeenCalled()

    const audio = previewAudioMocks.state.current
    expect(audio).not.toBeNull()

    playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0.4 }
    rerender(
      <PitchCorrectedAudio
        src="https://cdn.example.com/a.mp3"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(audio?.volume).toBeCloseTo(0.4)
    })
    expect(audio?.muted).toBe(false)
    expect(previewGraphMocks.rampPreviewClipGain).not.toHaveBeenCalled()

    rerender(
      <PitchCorrectedAudio
        src="https://cdn.example.com/a.mp3"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        muted
      />,
    )

    await waitFor(() => {
      expect(audio?.muted).toBe(true)
      expect(audio?.volume).toBe(0)
    })
    expect(previewGraphMocks.rampPreviewClipGain).not.toHaveBeenCalled()
  })

  it('keeps same-origin blob sources on the Web Audio graph', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalledWith(
        previewAudioMocks.state.current,
      )
    })
    expect(previewAudioMocks.markPreviewAudioElementUsesWebAudio).toHaveBeenCalledWith(
      previewAudioMocks.state.current,
    )
  })
})

/**
 * Records every write to `element.volume` in order, so a restore that happens
 * to land on the pre-mute value by accident cannot be mistaken for a real one.
 */
function trackVolumeWrites(audio: HTMLAudioElement): number[] {
  const writes: number[] = []
  let value = audio.volume
  Object.defineProperty(audio, 'volume', {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = next
      writes.push(next)
    },
  })
  return writes
}

/**
 * Waits for the 50ms pre-warm timer to fire, then drains the entire
 * play()/then/catch/finally microtask chain, so assertions read a settled state
 * and a failure reports the actual write sequence instead of a waitFor timeout.
 */
async function settlePreWarm(audio: HTMLAudioElement) {
  await waitFor(() => expect(audio.play).toHaveBeenCalled())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('PitchCorrectedAudio paused-seek pre-warm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStoreState.current = { isPlaying: false, previewFrame: null }
    previewGraphMocks.graph.outputGainNode.gain.value = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
  })

  // Moving the playhead while paused schedules a muted play/pause that fills the
  // decoder. Pressing play afterwards does not change resolvedVolume or muted,
  // so the volume effect never re-runs — whatever this restores is what the user
  // hears for the rest of the clip.
  function scrubWhilePaused(src: string, rerender: (ui: React.ReactElement) => void) {
    playbackStateMocks.current = { ...playbackStateMocks.current, frame: 6 }
    rerender(
      <PitchCorrectedAudio
        src={src}
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )
  }

  function renderClip(src: string) {
    return render(
      <PitchCorrectedAudio
        src={src}
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )
  }

  describe('on the direct path (cross-origin host source, no Web Audio graph)', () => {
    const SRC = 'https://cdn.example.com/signed.mp3'

    it('restores the clip volume after the pre-warm play resolves', async () => {
      playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0.4 }
      const { rerender } = renderClip(SRC)

      const audio = previewAudioMocks.state.current!
      await waitFor(() => expect(audio.volume).toBeCloseTo(0.4))
      expect(previewGraphMocks.createPreviewClipAudioGraph).not.toHaveBeenCalled()

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(SRC, rerender)

      await settlePreWarm(audio)
      expect(writes).toEqual([0, 0.4])
      expect(audio.volume).toBeCloseTo(0.4)
    })

    it('restores the clip volume when the pre-warm play is rejected', async () => {
      playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0.4 }
      const { rerender } = renderClip(SRC)

      const audio = previewAudioMocks.state.current!
      await waitFor(() => expect(audio.volume).toBeCloseTo(0.4))
      ;(audio.play as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.reject(new Error('NotAllowedError')),
      )

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(SRC, rerender)

      await settlePreWarm(audio)
      expect(writes).toEqual([0, 0.4])
      expect(audio.volume).toBeCloseTo(0.4)
    })
  })

  describe('on the Web Audio graph path (same-origin source)', () => {
    const SRC = 'blob:audio-prewarm'

    it('restores the graph gain and leaves element.volume alone', async () => {
      const { rerender } = renderClip(SRC)

      await waitFor(() =>
        expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalled(),
      )
      const audio = previewAudioMocks.state.current!
      previewGraphMocks.graph.outputGainNode.gain.value = 0.42

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(SRC, rerender)

      await settlePreWarm(audio)
      expect(previewGraphMocks.setPreviewClipGain.mock.calls).toEqual([
        [previewGraphMocks.graph, 0],
        [previewGraphMocks.graph, 0.42],
      ])
      expect(writes).toEqual([])
      expect(audio.volume).toBe(1)
    })

    it('restores the graph gain when the pre-warm play is rejected', async () => {
      const { rerender } = renderClip(SRC)

      await waitFor(() =>
        expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalled(),
      )
      const audio = previewAudioMocks.state.current!
      previewGraphMocks.graph.outputGainNode.gain.value = 0.42
      ;(audio.play as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.reject(new Error('NotAllowedError')),
      )

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(SRC, rerender)

      await settlePreWarm(audio)
      expect(previewGraphMocks.setPreviewClipGain.mock.calls).toEqual([
        [previewGraphMocks.graph, 0],
        [previewGraphMocks.graph, 0.42],
      ])
      expect(writes).toEqual([])
      expect(audio.pause).not.toHaveBeenCalled()
    })
  })

  // The pre-warm's play() promise is still pending when transport starts. The
  // clip must keep playing (no pause) AND get its level back — skipping the
  // restore here is the same silent-clip symptom, and it reaches the graph path
  // too, so standalone FreeCut is exposed as well.
  describe('when playback starts while the pre-warm play is still pending', () => {
    /** Simulates the user pressing Play between play() and its promise settling. */
    function startTransportOnPlay(audio: HTMLAudioElement, outcome: 'resolve' | 'reject') {
      ;(audio.play as ReturnType<typeof vi.fn>).mockImplementation(() => {
        playbackStoreState.current = { isPlaying: true, previewFrame: null }
        if (outcome === 'reject') {
          return Promise.reject(new Error('NotAllowedError'))
        }
        ;(audio as unknown as { paused: boolean }).paused = false
        return Promise.resolve()
      })
    }

    const DIRECT_SRC = 'https://cdn.example.com/signed.mp3'
    const GRAPH_SRC = 'blob:audio-prewarm-transport'

    it('leaves the clip audible on the direct path when the play resolves', async () => {
      playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0.4 }
      const { rerender } = renderClip(DIRECT_SRC)

      const audio = previewAudioMocks.state.current!
      await waitFor(() => expect(audio.volume).toBeCloseTo(0.4))
      startTransportOnPlay(audio, 'resolve')

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(DIRECT_SRC, rerender)

      await settlePreWarm(audio)
      expect(writes).toEqual([0, 0.4])
      expect(audio.volume).toBeCloseTo(0.4)
      // Transport owns the element now — the pre-warm must not stop it.
      expect(audio.pause).not.toHaveBeenCalled()
    })

    it('leaves the clip audible on the direct path when the play is rejected', async () => {
      playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0.4 }
      const { rerender } = renderClip(DIRECT_SRC)

      const audio = previewAudioMocks.state.current!
      await waitFor(() => expect(audio.volume).toBeCloseTo(0.4))
      startTransportOnPlay(audio, 'reject')

      const writes = trackVolumeWrites(audio)
      scrubWhilePaused(DIRECT_SRC, rerender)

      await settlePreWarm(audio)
      expect(writes).toEqual([0, 0.4])
      expect(audio.volume).toBeCloseTo(0.4)
    })

    it('leaves the clip audible on the graph path when the play resolves', async () => {
      const { rerender } = renderClip(GRAPH_SRC)

      await waitFor(() =>
        expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalled(),
      )
      const audio = previewAudioMocks.state.current!
      previewGraphMocks.graph.outputGainNode.gain.value = 0.42
      startTransportOnPlay(audio, 'resolve')

      scrubWhilePaused(GRAPH_SRC, rerender)

      await settlePreWarm(audio)
      expect(previewGraphMocks.setPreviewClipGain.mock.calls).toEqual([
        [previewGraphMocks.graph, 0],
        [previewGraphMocks.graph, 0.42],
      ])
      expect(audio.pause).not.toHaveBeenCalled()
    })

    it('leaves the clip audible on the graph path when the play is rejected', async () => {
      const { rerender } = renderClip(GRAPH_SRC)

      await waitFor(() =>
        expect(previewGraphMocks.graph.context.createMediaElementSource).toHaveBeenCalled(),
      )
      const audio = previewAudioMocks.state.current!
      previewGraphMocks.graph.outputGainNode.gain.value = 0.42
      startTransportOnPlay(audio, 'reject')

      scrubWhilePaused(GRAPH_SRC, rerender)

      await settlePreWarm(audio)
      expect(previewGraphMocks.setPreviewClipGain.mock.calls).toEqual([
        [previewGraphMocks.graph, 0],
        [previewGraphMocks.graph, 0.42],
      ])
    })

    // Guard, not a regression witness: this holds with or without the
    // unconditional restore. It pins that restoring while transport runs cannot
    // un-mute a clip the user silenced — previousGain is 0 for a muted clip, so
    // the restore writes 0 and the clip stays correctly silent.
    it('keeps a legitimately muted clip silent rather than restoring it to audible', async () => {
      playbackStateMocks.current = { ...playbackStateMocks.current, resolvedVolume: 0 }
      const { rerender } = render(
        <PitchCorrectedAudio
          src={DIRECT_SRC}
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={120}
          playbackRate={1}
          muted
        />,
      )

      const audio = previewAudioMocks.state.current!
      await waitFor(() => expect(audio.muted).toBe(true))
      expect(audio.volume).toBe(0)
      startTransportOnPlay(audio, 'resolve')

      playbackStateMocks.current = { ...playbackStateMocks.current, frame: 6 }
      rerender(
        <PitchCorrectedAudio
          src={DIRECT_SRC}
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={120}
          playbackRate={1}
          muted
        />,
      )

      await waitFor(() => expect(audio.play).toHaveBeenCalled())
      await waitFor(() => expect(audio.volume).toBe(0))
      expect(audio.muted).toBe(true)
    })
  })
})
