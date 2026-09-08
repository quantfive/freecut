import { createRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, screen, renderHook } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useKeyframeGestureCancellation } from './use-keyframe-gesture-cancellation'
import { DopesheetEditor } from './dopesheet-editor'
import { EasingCurveEditor } from './dopesheet-editor/easing-curve-editor'
import { GraphPlayhead } from './value-graph-editor/graph-curve'
import { useGraphInteraction } from './value-graph-editor/use-graph-interaction'
import { DEFAULT_GRAPH_PADDING, type GraphKeyframePoint } from './value-graph-editor/types'

const viewport = {
  width: 600,
  height: 300,
  startFrame: 0,
  endFrame: 60,
  minValue: 0,
  maxValue: 100,
}
const bezier = { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }
const points: GraphKeyframePoint[] = [10, 30].map((frame, i) => ({
  keyframe: {
    id: `kf-${i}`,
    frame,
    value: 30 + i * 20,
    easing: 'cubic-bezier',
    easingConfig: { type: 'cubic-bezier', bezier },
  },
  itemId: 'item',
  property: 'x',
  x: 100 + i * 150,
  y: 150 - i * 50,
  isSelected: i === 0,
  isDragging: false,
}))
let rafs: Map<number, FrameRequestCallback>
let rafId = 0
const cancel = (node: Element) =>
  act(() => {
    node.dispatchEvent(new CustomEvent('freecut:cancel-timeline-gesture', { bubbles: true }))
  })
const flush = () =>
  act(() => {
    const queued = [...rafs.values()]
    rafs.clear()
    queued.forEach((fn) => fn(16))
  })
const pointer = { button: 0, pointerId: 7, clientX: 100, clientY: 150 }
const moved = { ...pointer, clientX: 160, clientY: 120 }
function transaction() {
  let value = 100
  let snapshot = value
  const history: number[] = []
  return {
    get value() {
      return value
    },
    history,
    begin: vi.fn(() => {
      snapshot = value
    }),
    change: vi.fn((next: number) => {
      value = next
    }),
    end: vi.fn(() => {
      if (snapshot !== value) history.push(snapshot)
    }),
    cancel: vi.fn(() => {
      value = snapshot
    }),
    undo: () => {
      value = history.pop() ?? value
    },
  }
}

beforeEach(() => {
  rafs = new Map()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    rafs.set(++rafId, fn)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => rafs.delete(id))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 300,
    width: 600,
    height: 300,
    toJSON() {},
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => true,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'setPointerCapture')
  Reflect.deleteProperty(Element.prototype, 'releasePointerCapture')
  Reflect.deleteProperty(Element.prototype, 'hasPointerCapture')
})

describe('retained dopesheet gesture cancellation', () => {
  it.each(['pending', 'active', 'duplicate', 'group', 'unmount'])(
    'retires %s diamond intent before a late release',
    (mode) => {
      const tx = transaction()
      const duplicate = vi.fn()
      const ui = render(
        <div data-editor-workspace-shell="" data-testid="shell">
          <DopesheetEditor
            itemId="item"
            width={640}
            height={240}
            keyframesByProperty={{ x: [points[0]!.keyframe] }}
            selectedKeyframeIds={new Set(['kf-0'])}
            onKeyframeMove={(_ref, frame) => tx.change(frame)}
            onDuplicateKeyframes={duplicate}
            onDragStart={tx.begin}
            onDragEnd={tx.end}
            onDragCancel={tx.cancel}
          />
        </div>,
      )
      if (mode === 'group')
        fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }))
      const diamond =
        mode === 'group'
          ? ui.container.querySelector('[data-testid^="group-keyframe-"]')!
          : screen.getByTestId('row-keyframe-x-kf-0')
      fireEvent.pointerDown(diamond, { ...pointer, altKey: mode === 'duplicate' })
      if (mode !== 'pending') fireEvent.pointerMove(window, moved)
      if (mode === 'unmount') ui.unmount()
      else cancel(screen.getByTestId('shell'))
      fireEvent.pointerMove(window, moved)
      fireEvent.pointerUp(window, moved)
      fireEvent.pointerUp(window, moved)
      flush()
      expect(tx.change).not.toHaveBeenCalled()
      expect(duplicate).not.toHaveBeenCalled()
      expect(tx.end).not.toHaveBeenCalled()
      expect(tx.history).toEqual([])
      expect(Element.prototype.releasePointerCapture).toHaveBeenCalledWith(7)
    },
  )

  it.each(['normal', 'foreign', 'duplicate-normal', 'delegated-cancel'])(
    'diamond %s keeps its commit/undo boundary',
    (mode) => {
      const tx = transaction()
      const duplicate = vi.fn(() => {
        tx.begin()
        tx.change(200)
        tx.end()
      })
      render(
        <div data-editor-workspace-shell="" data-testid="outer">
          <div data-editor-workspace-shell="" data-testid="shell">
            <DopesheetEditor
              itemId="item"
              width={640}
              height={240}
              keyframesByProperty={{ x: [points[0]!.keyframe] }}
              selectedKeyframeIds={new Set(['kf-0'])}
              onKeyframeMove={(_ref, frame) => tx.change(frame)}
              onDuplicateKeyframes={duplicate}
              onSelectionFrameDelta={
                mode === 'delegated-cancel'
                  ? (delta, phase) => {
                      if (phase === 'preview') tx.change(100 + delta)
                      return true
                    }
                  : undefined
              }
              onDragStart={tx.begin}
              onDragEnd={tx.end}
              onDragCancel={tx.cancel}
            />
          </div>
        </div>,
      )
      fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kf-0'), {
        ...pointer,
        altKey: mode === 'duplicate-normal',
      })
      fireEvent.pointerMove(window, moved)
      if (mode === 'foreign') cancel(screen.getByTestId('outer'))
      if (mode === 'delegated-cancel') {
        expect(tx.value).not.toBe(100)
        cancel(screen.getByTestId('shell'))
      }
      fireEvent.pointerUp(window, moved)
      fireEvent.pointerUp(window, moved)
      if (mode === 'delegated-cancel') {
        expect(tx.value).toBe(100)
        expect(tx.history).toEqual([])
      } else {
        expect(tx.value).not.toBe(100)
        expect(tx.history).toEqual([100])
        tx.undo()
        expect(tx.value).toBe(100)
      }
    },
  )

  it.each(['normal', 'foreign', 'cancel', 'pending'])(
    'property scrub %s preserves one transaction',
    (mode) => {
      const tx = transaction()
      render(
        <div data-editor-workspace-shell="" data-testid="outer">
          <div data-editor-workspace-shell="" data-testid="shell">
            <DopesheetEditor
              itemId="item"
              width={640}
              height={240}
              keyframesByProperty={{ x: [] }}
              propertyValues={{ x: 100 }}
              onPropertyValuePreview={(_property, value) => tx.change(value)}
              onPropertyValueCommit={(_property, value) => tx.change(value)}
              onDragStart={tx.begin}
              onDragEnd={tx.end}
              onDragCancel={tx.cancel}
            />
          </div>
        </div>,
      )
      const input = screen.getByRole('spinbutton', { name: 'X Position value at playhead' })
      fireEvent.focus(input)
      fireEvent.pointerDown(input, pointer)
      if (mode !== 'pending') fireEvent.pointerMove(input, moved)
      if (mode === 'foreign') cancel(screen.getByTestId('outer'))
      if (mode === 'cancel' || mode === 'pending') cancel(screen.getByTestId('shell'))
      const count = tx.change.mock.calls.length
      fireEvent.pointerUp(input, moved)
      fireEvent.pointerUp(input, moved)
      fireEvent.blur(input)
      if (mode === 'cancel' || mode === 'pending') {
        expect(tx.value).toBe(100)
        expect(tx.history).toEqual([])
        expect(tx.change).toHaveBeenCalledTimes(count)
      } else {
        expect(tx.value).not.toBe(100)
        expect(tx.history).toEqual([100])
        tx.undo()
        expect(tx.value).toBe(100)
      }
    },
  )

  it('cancels ruler pending frame and edge RAF while preserving last delivered frame', () => {
    const scrub = vi.fn()
    const end = vi.fn()
    const edge = vi.fn(() => 10)
    render(
      <div data-editor-workspace-shell="" data-testid="shell">
        <DopesheetEditor
          itemId="item"
          width={640}
          height={240}
          keyframesByProperty={{ x: [] }}
          onScrub={scrub}
          onScrubEnd={end}
          onRulerEdgeScroll={edge}
        />
      </div>,
    )
    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerDown(ruler, pointer)
    fireEvent.pointerMove(ruler, { ...moved, clientX: 900 })
    const calls = scrub.mock.calls.length
    cancel(screen.getByTestId('shell'))
    fireEvent.pointerMove(ruler, moved)
    fireEvent.pointerUp(ruler, moved)
    flush()
    flush()
    expect(scrub).toHaveBeenCalledTimes(calls)
    expect(edge).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
  })
})

function Graph({ tx, duplicate }: { tx: ReturnType<typeof transaction>; duplicate: () => void }) {
  const h = useGraphInteraction({
    viewport,
    padding: DEFAULT_GRAPH_PADDING,
    points,
    selectedKeyframeIds: new Set(['kf-0']),
    onKeyframeMove: (_ref, frame) => tx.change(frame),
    onDuplicateKeyframes: duplicate,
    onBezierHandleMove: (_ref, next) => tx.change(next.x1),
    onDragStart: tx.begin,
    onDragEnd: tx.end,
    onDragCancel: tx.cancel,
  })
  return (
    <svg data-testid="graph" onPointerMove={h.handlePointerMove} onPointerUp={h.handlePointerUp}>
      <circle
        data-testid="point"
        onPointerDown={(e) => h.handleKeyframePointerDown(points[0]!, e)}
      />
      <circle
        data-testid="bezier"
        onPointerDown={(e) =>
          h.handleBezierPointerDown(
            { keyframeId: 'kf-0', type: 'out', x: 130, y: 140, anchorX: 100, anchorY: 150 },
            e,
          )
        }
      />
    </svg>
  )
}
it.each(['pending', 'active', 'duplicate', 'bezier', 'normal-bezier', 'normal', 'foreign'])(
  'value graph %s has terminal cancellation and normal commit',
  (mode) => {
    const tx = transaction()
    const duplicate = vi.fn()
    render(
      <div data-editor-workspace-shell="" data-testid="outer">
        <div data-editor-workspace-shell="" data-testid="shell">
          <Graph tx={tx} duplicate={duplicate} />
        </div>
      </div>,
    )
    fireEvent.pointerDown(screen.getByTestId(mode.includes('bezier') ? 'bezier' : 'point'), {
      ...pointer,
      altKey: mode === 'duplicate',
    })
    if (mode !== 'pending') fireEvent.pointerMove(screen.getByTestId('graph'), moved)
    if (mode === 'foreign') cancel(screen.getByTestId('outer'))
    else if (!mode.startsWith('normal')) cancel(screen.getByTestId('shell'))
    fireEvent.pointerUp(screen.getByTestId('graph'), moved)
    fireEvent.pointerUp(screen.getByTestId('graph'), moved)
    if (mode.startsWith('normal') || mode === 'foreign') {
      expect(tx.history).toEqual([100])
      tx.undo()
      expect(tx.value).toBe(100)
    } else {
      expect(tx.value).toBe(100)
      expect(tx.history).toEqual([])
      expect(duplicate).not.toHaveBeenCalled()
      expect(tx.change).not.toHaveBeenCalled()
    }
  },
)

it('hidden graph playhead hit area cancels capture listeners and queued frame', () => {
  const scrub = vi.fn()
  const end = vi.fn()
  const ui = render(
    <div data-editor-workspace-shell="" data-testid="shell">
      <svg>
        <GraphPlayhead
          frame={10}
          viewport={viewport}
          padding={DEFAULT_GRAPH_PADDING}
          visuals="hidden"
          onScrub={scrub}
          onScrubEnd={end}
        />
      </svg>
    </div>,
  )
  const line = ui.container.querySelector('line')!
  const svg = ui.container.querySelector('svg')!
  fireEvent.pointerDown(line, pointer)
  fireEvent.pointerMove(svg, moved)
  cancel(screen.getByTestId('shell'))
  fireEvent.pointerMove(svg, moved)
  fireEvent.pointerUp(svg, moved)
  flush()
  expect(scrub).toHaveBeenCalledTimes(1)
  expect(scrub).toHaveBeenCalledWith(10)
  expect(end).toHaveBeenCalledTimes(1)
})

function PortalFixture({ tx }: { tx: ReturnType<typeof transaction> }) {
  const [currentBezier, setCurrentBezier] = useState(bezier)
  const [ownerRef] = useState(() => createRef<HTMLButtonElement>())
  return (
    <div data-editor-workspace-shell="" data-testid="outer">
      <div data-editor-workspace-shell="" data-testid="shell">
        <button ref={ownerRef}>Origin</button>
        {createPortal(
          <EasingCurveEditor
            easing="cubic-bezier"
            config={{ type: 'cubic-bezier', bezier: currentBezier }}
            ownerRef={ownerRef}
            onChangeBezier={(next) => {
              tx.change(next.x1)
              setCurrentBezier(next)
            }}
            onChangeSpring={vi.fn()}
            onDragStart={tx.begin}
            onDragEnd={tx.end}
            onDragCancel={() => {
              tx.cancel()
              setCurrentBezier(bezier)
            }}
          />,
          document.body,
        )}
      </div>
    </div>
  )
}

it.each(['hide', 'pending-hide', 'foreign', 'normal', 'slider-hide', 'slider-normal'])(
  'portal easing %s retires callbacks before restoring snapshot',
  (mode) => {
    const tx = transaction()
    const ui = render(<PortalFixture tx={tx} />)
    const handle = mode.startsWith('slider')
      ? document.querySelector('[aria-label="x1"]')!
      : document.querySelector('g.cursor-grab')!
    const pointerTarget = mode.startsWith('slider') ? handle : window
    fireEvent.pointerDown(handle, pointer)
    if (mode !== 'pending-hide') {
      fireEvent.pointerMove(pointerTarget, moved)
      expect(tx.value).not.toBe(100)
    }
    if (mode.endsWith('hide')) cancel(screen.getByTestId('shell'))
    if (mode === 'foreign') cancel(screen.getByTestId('outer'))
    fireEvent.pointerMove(pointerTarget, moved)
    fireEvent.pointerUp(pointerTarget, moved)
    fireEvent.pointerUp(pointerTarget, moved)
    if (mode.endsWith('hide')) {
      expect(tx.value).toBe(100)
      expect(tx.history).toEqual([])
    } else {
      expect(tx.history).toEqual([100])
      tx.undo()
      expect(tx.value).toBe(100)
    }
    ui.unmount()
  },
)

it('uses the current callback without cancelling on rerender, fails closed without owner, and disposes', () => {
  const owner = document.createElement('div')
  const shell = document.createElement('div')
  shell.setAttribute('data-editor-workspace-shell', '')
  shell.append(owner)
  document.body.append(shell)
  const first = vi.fn()
  const latest = vi.fn()
  const ownerRef = { current: owner as Element | null }
  const hook = renderHook(({ callback }) => useKeyframeGestureCancellation(ownerRef, callback), {
    initialProps: { callback: first },
  })
  hook.rerender({ callback: latest })
  expect(first).not.toHaveBeenCalled()
  expect(latest).not.toHaveBeenCalled()
  cancel(shell)
  expect(latest).toHaveBeenCalledWith(true)
  ownerRef.current = null
  cancel(shell)
  expect(latest).toHaveBeenCalledTimes(1)
  hook.unmount()
  expect(latest).toHaveBeenLastCalledWith(false)
  cancel(shell)
  expect(latest).toHaveBeenCalledTimes(2)
  shell.remove()
})
