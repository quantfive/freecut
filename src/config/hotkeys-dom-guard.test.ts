// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
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

function GlobalCaptureHarness({
  onHotkey,
  children,
}: {
  onHotkey: () => void
  children?: ReactNode
}) {
  useHotkeys('k', onHotkey, { ...HOTKEY_OPTIONS, eventListenerOptions: { capture: true } }, [
    onHotkey,
  ])
  return children ?? null
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

  it.each([
    ['native button', '<button id="control">Run</button>'],
    ['native link', '<a href="/project" id="control">Project</a>'],
    ['summary', '<details><summary id="control">Details</summary></details>'],
    ['button role', '<div role="button" tabindex="0" id="control">Run</div>'],
    ['scrollbar role', '<div role="scrollbar" tabindex="0" id="control"></div>'],
    ['menuitem role', '<div role="menuitem" tabindex="0" id="control">Open</div>'],
  ])('guards an interactive %s outside dialogs', (_name, markup) => {
    expect(dispatchFrom(markup, '#control', 'k')).toEqual({
      captureSawEvent: true,
      defaultPrevented: false,
    })
  })

  it('guards every dialog descendant, even when the target is a plain span', () => {
    expect(
      dispatchFrom('<div role="dialog"><span id="control">Message</span></div>', '#control', 'j'),
    ).toEqual({ captureSawEvent: true, defaultPrevented: false })
  })

  it('guards plain descendants of a native dialog', () => {
    expect(
      dispatchFrom('<dialog open><span id="control">Message</span></dialog>', '#control', 'j'),
    ).toEqual({
      captureSawEvent: true,
      defaultPrevented: false,
    })
  })

  it('uses the nearest contenteditable value for inherited editing and false islands', () => {
    expect(
      dispatchFrom(
        '<div contenteditable="true"><span id="editable">text</span></div>',
        '#editable',
        'j',
      ),
    ).toEqual({ captureSawEvent: true, defaultPrevented: false })

    expect(
      dispatchFrom(
        '<div contenteditable="true"><div contenteditable="false"><span id="island">clip</span></div></div>',
        '#island',
        'j',
      ),
    ).toEqual({ captureSawEvent: true, defaultPrevented: true })
  })

  it('keeps ordinary canvas targets eligible for editor shortcuts', () => {
    expect(dispatchFrom('<canvas id="timeline"></canvas>', '#timeline', 'k')).toEqual({
      captureSawEvent: true,
      defaultPrevented: true,
    })
  })

  it('preserves explicit canvas opt-in inside a native dialog', () => {
    expect(
      dispatchFrom(
        '<dialog open><canvas data-global-hotkeys="allow" id="timeline"></canvas></dialog>',
        '#timeline',
        'k',
      ),
    ).toEqual({ captureSawEvent: true, defaultPrevented: true })
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

  it('keeps the real capture listener inert on a native button without swallowing bubbling', () => {
    const onHotkey = vi.fn()
    const rendered = render(
      createElement(
        GlobalCaptureHarness,
        { onHotkey },
        createElement('button', { type: 'button' }, 'Run'),
      ),
    )
    const target = screen.getByRole('button', { name: 'Run' })
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

  it('executes one real capture handler once on an ordinary canvas', () => {
    const onHotkey = vi.fn()
    const rendered = render(
      createElement(
        GlobalCaptureHarness,
        { onHotkey },
        createElement('canvas', { 'aria-label': 'Timeline canvas' }),
      ),
    )
    const target = screen.getByLabelText('Timeline canvas')
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      bubbles: true,
      cancelable: true,
    })

    target.dispatchEvent(event)

    rendered.unmount()
    expect(onHotkey).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
