// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import * as registration from './use-hotkey-registration'

vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }))
vi.mock('@/config/hotkeys', () => ({ HOTKEY_OPTIONS: {} }))
vi.mock('./use-runtime-hotkey-binding', () => ({ useRuntimeHotkeyBinding: vi.fn() }))

describe('hotkey registration adapter surface', () => {
  it('loads with a partial hotkey config mock and exposes no command proxy object API', () => {
    expect(registration).not.toHaveProperty('COMMAND_HOTKEYS')
  })

  it('rejects invalid command literals at typecheck', () => {
    // @ts-expect-error invalid command literals cannot enter the adapter API
    const invalidCommand: Parameters<typeof registration.useCommandHotkey>[0] = 'NOT_A_COMMAND'
    expect(invalidCommand).toBe('NOT_A_COMMAND')
  })
})
