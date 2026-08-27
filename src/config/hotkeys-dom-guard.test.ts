// @vitest-environment jsdom

import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEY_OPTIONS, shouldIgnoreGlobalHotkey } from './hotkeys'

function CaptureHotkeyHarness({ onHotkey }: { onHotkey: () => void }) {
  useHotkeys('k', onHotkey, { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } }, [
    onHotkey,
  ])

  return createElement(
    'div',
    { role: 'dialog' },
    createElement('button', { type: 'button' }, 'Pause'),
  )
}

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

  it.each([
    ['input', '<div role="dialog"><input data-global-hotkeys="allow" id="control" /></div>'],
    [
      'contenteditable',
      '<div role="dialog"><div contenteditable="true" data-global-hotkeys="allow" id="control"></div></div>',
    ],
  ])('allows explicitly opted-in %s targets', (_name, markup) => {
    expect(dispatchFrom(markup, '#control', 'j')).toEqual({
      captureSawEvent: true,
      defaultPrevented: true,
    })
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

  it('keeps the real capture-phase hotkey listener inert for dialog K events', () => {
    const onHotkey = vi.fn()
    const rendered = render(createElement(CaptureHotkeyHarness, { onHotkey }))
    const target = screen.getByRole('button', { name: 'Pause' })
    const bubble = vi.fn()
    document.body.addEventListener('keydown', bubble)
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      bubbles: true,
      cancelable: true,
    })

    target.dispatchEvent(event)

    document.body.removeEventListener('keydown', bubble)
    rendered.unmount()
    expect(onHotkey).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(bubble).toHaveBeenCalledTimes(1)
  })
})
