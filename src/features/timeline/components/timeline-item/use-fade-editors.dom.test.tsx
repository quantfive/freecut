import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  clearMixerLiveGains,
  clearMixerLiveGainLayer,
  getMixerLiveGain,
  setMixerLiveGainLayer,
  setMixerLiveGains,
} from '@/shared/state/mixer-live-gain'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  makeTimelineAudioItem,
  resetTimelineCompositionTestState,
} from '../../test-helpers'
import { useFadeEditors } from './use-fade-editors'

type Mode =
  | 'video-in'
  | 'video-out'
  | 'audio-in'
  | 'audio-out'
  | 'curve-in'
  | 'curve-out'
  | 'volume'
const modes: Mode[] = [
  'video-in',
  'video-out',
  'audio-in',
  'audio-out',
  'curve-in',
  'curve-out',
  'volume',
]
function Surface({ mode, locked = false }: { mode: Mode; locked?: boolean }) {
  const item = useItemsStore((s) => s.items[0]!)
  const owner = useRef<HTMLDivElement>(null)
  const active = useRef(false)
  const edit = useFadeEditors({
    item,
    fps: 30,
    activeTool: 'select',
    trackLocked: locked,
    isAnyDragActiveRef: active,
    transformRef: owner,
    updateTimelineItem: useTimelineStore.getState().updateItem,
  })
  const handle = mode.endsWith('out') ? 'out' : 'in'
  return (
    <div data-editor-workspace-shell data-testid="outer">
      <div data-editor-workspace-shell data-testid="root">
        <div ref={owner} data-testid="owner">
          <div ref={edit.videoControlsRef} data-geometry />
          <div ref={edit.audioControlsRef} data-geometry />
          <div ref={edit.volumeLineRef} />
          <button
            onMouseDown={(e) => {
              if (mode.startsWith('video')) edit.handleVideoFadeHandleMouseDown(e, handle)
              else if (mode.startsWith('audio')) edit.handleAudioFadeHandleMouseDown(e, handle)
              else if (mode.startsWith('curve')) edit.handleAudioFadeCurveDotMouseDown(e, handle)
              else edit.handleAudioVolumeMouseDown(e)
            }}
          >
            Gesture
          </button>
          <output>
            {JSON.stringify({
              video: edit.videoFadeEdit,
              audio: edit.audioFadeEdit,
              curve: edit.audioFadeCurveEdit,
              volume: edit.audioVolumeEdit,
            })}
          </output>
        </div>
      </div>
      <div data-editor-workspace-shell data-testid="foreign" />
    </div>
  )
}
function mount(mode: Mode) {
  const base = {
    id: 'clip',
    from: 0,
    durationInFrames: 60,
    fadeIn: 0.2,
    fadeOut: 0.2,
    audioFadeIn: 0.4,
    audioFadeOut: 0.4,
    volume: 0,
  }
  useItemsStore
    .getState()
    .setItems([
      mode.startsWith('video') ? makeTimelineVideoItem(base) : makeTimelineAudioItem(base),
    ])
  const view = render(<Surface mode={mode} />)
  for (const el of view.container.querySelectorAll<HTMLElement>(
    '[data-geometry],[data-testid="owner"]',
  ))
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
  return view
}
function press(view: ReturnType<typeof mount>, mode: Mode) {
  fireEvent.mouseDown(view.getByRole('button'), {
    button: 0,
    clientX: mode.endsWith('out') ? 180 : 20,
    clientY: 50,
  })
}
function move(mode: Mode) {
  fireEvent.mouseMove(window, { clientX: mode.endsWith('out') ? 150 : 60, clientY: 20 })
}
function cancel(el: Element) {
  act(() => {
    el.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
  })
}
function snapshot() {
  return structuredClone(useItemsStore.getState().items)
}
function idle(view: ReturnType<typeof mount>) {
  expect(view.container.querySelector('output')?.textContent).toBe(
    '{"video":null,"audio":null,"curve":null,"volume":null}',
  )
}
beforeEach(() => {
  resetTimelineCompositionTestState()
  clearMixerLiveGains()
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'Video', order: 0 }),
      makeTimelineTrack({ id: 'track-a1', name: 'Audio', order: 1 }),
    ])
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearMixerLiveGains()
})
describe('retained fade and volume lifecycle', () => {
  it.each(modes)('%s cancels changed preview, duplicate cancellation and late mouseup', (mode) => {
    const view = mount(mode),
      before = snapshot()
    setMixerLiveGains([{ itemId: 'clip', gain: 1.7 }])
    setMixerLiveGainLayer('other', [{ itemId: 'clip', gain: 0.5 }])
    const gain = getMixerLiveGain('clip')
    press(view, mode)
    move(mode)
    expect(view.container.querySelector('output')?.textContent).not.toBe(
      '{"video":null,"audio":null,"curve":null,"volume":null}',
    )
    if (mode === 'volume') expect(getMixerLiveGain('clip')).not.toBe(gain)
    cancel(view.getByTestId('root'))
    cancel(view.getByTestId('root'))
    move(mode)
    fireEvent.mouseUp(window)
    expect(snapshot()).toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    idle(view)
    expect(getMixerLiveGain('clip')).toBeCloseTo(gain)
  })
  it.each(modes)('%s foreign root and rerender preserve one normal commit and undo', (mode) => {
    const view = mount(mode),
      before = snapshot()
    press(view, mode)
    move(mode)
    view.rerender(<Surface mode={mode} />)
    cancel(view.getByTestId('foreign'))
    cancel(view.getByTestId('outer'))
    fireEvent.mouseUp(window)
    fireEvent.mouseUp(window)
    expect(snapshot()).not.toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    act(() => useTimelineCommandStore.getState().undo())
    expect(snapshot()).toEqual(before)
  })
  it.each(modes)('%s actual unmount discards preview and leaves no late commit', (mode) => {
    const view = mount(mode),
      before = snapshot()
    press(view, mode)
    move(mode)
    view.unmount()
    move(mode)
    fireEvent.mouseUp(window)
    expect(snapshot()).toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(getMixerLiveGain('clip')).toBe(1)
  })
  it('cancels pending volume timeout before activation or late movement', () => {
    vi.useFakeTimers()
    const view = mount('volume'),
      before = snapshot()
    press(view, 'volume')
    cancel(view.getByTestId('root'))
    act(() => vi.advanceTimersByTime(500))
    move('volume')
    fireEvent.mouseUp(window)
    idle(view)
    expect(snapshot()).toEqual(before)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    expect(getMixerLiveGain('clip')).toBe(1)
  })
  it.each([0.5, 0])(
    'restores the owned default gain with an initial foreign layer of %s',
    (foreignGain) => {
      const view = mount('volume')
      const before = snapshot()
      setMixerLiveGains([{ itemId: 'clip', gain: 1.7 }])
      setMixerLiveGainLayer('other', [{ itemId: 'clip', gain: foreignGain }])
      press(view, 'volume')
      move('volume')
      if (foreignGain !== 0) setMixerLiveGainLayer('other', [{ itemId: 'clip', gain: 0.8 }])
      cancel(view.getByTestId('root'))
      expect(getMixerLiveGain('clip')).toBeCloseTo(1.7 * (foreignGain === 0 ? 0 : 0.8))
      clearMixerLiveGainLayer('other')
      expect(getMixerLiveGain('clip')).toBeCloseTo(1.7)
      fireEvent.mouseUp(window)
      expect(snapshot()).toEqual(before)
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
    },
  )
})
