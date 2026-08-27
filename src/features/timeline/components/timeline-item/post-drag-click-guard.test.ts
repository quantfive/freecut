import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  resetPostTimelineGestureClickForTest,
  suppressPostTimelineGestureClick,
} from './post-drag-click-guard'

function dispatchMouseEvent(target: EventTarget, type: 'mousedown' | 'click', detail = 1) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail }))
}

describe('post timeline gesture click ownership', () => {
  afterEach(() => resetPostTimelineGestureClickForTest())

  it('suppresses exactly one browser-generated click', () => {
    const element = document.createElement('button')
    const onClick = vi.fn()
    element.addEventListener('click', onClick)
    document.body.appendChild(element)

    suppressPostTimelineGestureClick()
    dispatchMouseEvent(element, 'click')
    dispatchMouseEvent(element, 'click')

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('releases ownership when a later independent mouse gesture starts', () => {
    const element = document.createElement('button')
    const onClick = vi.fn()
    element.addEventListener('click', onClick)
    document.body.appendChild(element)

    suppressPostTimelineGestureClick()
    dispatchMouseEvent(element, 'mousedown')
    dispatchMouseEvent(element, 'click')

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not suppress keyboard or programmatic activation', () => {
    const element = document.createElement('button')
    const onClick = vi.fn()
    element.addEventListener('click', onClick)
    document.body.appendChild(element)

    suppressPostTimelineGestureClick()
    dispatchMouseEvent(element, 'click', 0)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
