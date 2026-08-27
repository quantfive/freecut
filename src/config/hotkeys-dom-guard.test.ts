// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vite-plus/test'
import { shouldIgnoreGlobalHotkey } from './hotkeys'

describe('global shortcut DOM guards', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  function dispatchFrom(markup: string, selector: string, key: string) {
    document.body.innerHTML = markup
    const target = document.querySelector(selector)
    if (!(target instanceof HTMLElement)) throw new Error(`Missing ${selector}`)

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    let captureSawEvent = false
    const captureListener = (capturedEvent: KeyboardEvent) => {
      captureSawEvent = true
      if (!shouldIgnoreGlobalHotkey(capturedEvent)) capturedEvent.preventDefault()
    }
    document.addEventListener('keydown', captureListener, { capture: true })
    target.dispatchEvent(event)
    document.removeEventListener('keydown', captureListener, { capture: true })
    return { captureSawEvent, defaultPrevented: event.defaultPrevented }
  }

  it('still receives events in capture phase but does not handle contenteditable targets', () => {
    const result = dispatchFrom(
      '<div contenteditable="true"><span id="editor">text</span></div>',
      '#editor',
      'j',
    )

    expect(result).toEqual({ captureSawEvent: true, defaultPrevented: false })
  })

  it.each(['button', 'input', 'textarea', 'select'])('guards dialog %s controls', (tagName) => {
    const result = dispatchFrom(
      `<div role="dialog"><${tagName} id="control"></${tagName}></div>`,
      '#control',
      'j',
    )

    expect(result).toEqual({ captureSawEvent: true, defaultPrevented: false })
  })

  it('allows an explicitly opted-in dialog control', () => {
    const result = dispatchFrom(
      '<div role="dialog"><button data-global-hotkeys="allow" id="control">Run</button></div>',
      '#control',
      'j',
    )

    expect(result).toEqual({ captureSawEvent: true, defaultPrevented: true })
  })

  it('preserves dialog K events without preventDefault or propagation swallowing', () => {
    document.body.innerHTML = '<div role="dialog"><button id="control">Pause</button></div>'
    const target = document.querySelector('#control') as HTMLButtonElement
    const bubble = vi.fn()
    document.body.addEventListener('keydown', bubble)
    const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true })
    const captureListener = (capturedEvent: KeyboardEvent) => {
      if (!shouldIgnoreGlobalHotkey(capturedEvent)) {
        capturedEvent.preventDefault()
        capturedEvent.stopPropagation()
      }
    }

    document.addEventListener('keydown', captureListener, { capture: true })
    target.dispatchEvent(event)
    document.removeEventListener('keydown', captureListener, { capture: true })
    document.body.removeEventListener('keydown', bubble)

    expect(event.defaultPrevented).toBe(false)
    expect(bubble).toHaveBeenCalledTimes(1)
  })
})
