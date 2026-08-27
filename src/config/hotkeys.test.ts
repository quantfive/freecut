// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  HOTKEYS,
  HOTKEY_EXPORT_SCHEMA,
  HOTKEY_EXPORT_VERSION,
  createHotkeyExportDocument,
  findHotkeyConflicts,
  formatHotkeyBinding,
  getBrowserHostileHotkey,
  getHotkeyBindingFromEventData,
  getHotkeyPrimaryTokenFromEventData,
  normalizeHotkeyBinding,
  parseHotkeyImportDocument,
  resolveHotkeyConfiguration,
  resolveHotkeys,
  sanitizeHotkeyOverrides,
} from './hotkeys'

describe('keyframe productivity hotkeys', () => {
  it('provides distinct defaults for the focused editor workflow', () => {
    expect({
      split: HOTKEYS.KEYFRAME_EDITOR_SPLIT,
      addInEdit: HOTKEYS.EDIT_KEYFRAME_ADD,
      previous: HOTKEYS.KEYFRAME_PREVIOUS,
      next: HOTKEYS.KEYFRAME_NEXT,
      auto: HOTKEYS.KEYFRAME_TOGGLE_AUTO,
      fit: HOTKEYS.KEYFRAME_FIT,
    }).toEqual({
      split: '3',
      addInEdit: 'shift+k',
      previous: 'alt+bracketleft',
      next: 'alt+bracketright',
      auto: 'a',
      fit: 'f',
    })
  })
})

describe('transport and editing defaults', () => {
  it('uses canonical J/K/L transport without conflicting with keyframe add', () => {
    expect({
      reverse: HOTKEYS.SHUTTLE_REVERSE,
      pause: HOTKEYS.SHUTTLE_PAUSE,
      forward: HOTKEYS.SHUTTLE_FORWARD,
      addKeyframe: HOTKEYS.EDIT_KEYFRAME_ADD,
      splitAtPlayhead: HOTKEYS.SPLIT_AT_PLAYHEAD,
    }).toEqual({
      reverse: 'j',
      pause: 'k',
      forward: 'l',
      addKeyframe: 'shift+k',
      splitAtPlayhead: 'shift+c',
    })
  })
})

describe('normalizeHotkeyBinding', () => {
  it('orders modifiers consistently and normalizes aliases', () => {
    expect(normalizeHotkeyBinding('Shift+Ctrl+ArrowLeft')).toBe('mod+shift+left')
  })
})

describe('formatHotkeyBinding', () => {
  it('formats modifier labels for mac', () => {
    expect(formatHotkeyBinding('mod+alt+k', 'MacIntel')).toBe('Cmd + Option + K')
  })

  it('formats punctuation bindings for windows', () => {
    expect(formatHotkeyBinding('mod+shift+comma', 'Win32')).toBe('Ctrl + Shift + ,')
  })
})

describe('getBrowserHostileHotkey', () => {
  it('detects browser-reserved shortcuts after normalization', () => {
    expect(getBrowserHostileHotkey('Ctrl+E')).toEqual({
      binding: 'mod+e',
      browserAction: 'Focus search or address bar in some browsers',
    })
  })

  it('returns null for browser-safe shortcuts', () => {
    expect(getBrowserHostileHotkey('shift+j')).toBeNull()
  })

  it('flags browser zoom shortcuts as hostile', () => {
    expect(getBrowserHostileHotkey('Ctrl+=')).toEqual({
      binding: 'mod+equal',
      browserAction: 'Browser zoom in',
    })
    expect(getBrowserHostileHotkey('Ctrl+-')).toEqual({
      binding: 'mod+minus',
      browserAction: 'Browser zoom out',
    })
    expect(getBrowserHostileHotkey('Ctrl+0')).toEqual({
      binding: 'mod+0',
      browserAction: 'Reset browser zoom',
    })
  })

  it('flags Ctrl+Shift+L as hostile and leaves Shift+L available', () => {
    expect(getBrowserHostileHotkey('Ctrl+Shift+L')).toEqual({
      binding: 'mod+shift+l',
      browserAction: 'Focus address bar or search in some browsers',
    })
    expect(getBrowserHostileHotkey('Shift+L')).toBeNull()
  })
})

describe('getHotkeyBindingFromEventData', () => {
  it('captures letter bindings with modifiers', () => {
    expect(
      getHotkeyBindingFromEventData({
        code: 'KeyA',
        key: 'a',
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe('mod+shift+a')
  })

  it('captures modifier-only previews before a final key lands', () => {
    expect(
      getHotkeyBindingFromEventData({
        code: 'ShiftLeft',
        key: 'Shift',
        shiftKey: true,
      }),
    ).toBe('shift')
  })

  it('uses event.code for shifted punctuation keys', () => {
    expect(
      getHotkeyPrimaryTokenFromEventData({
        code: 'Comma',
        key: '<',
        shiftKey: true,
      }),
    ).toBe('comma')
  })
})

describe('findHotkeyConflicts', () => {
  it('returns other bindings using the same normalized shortcut', () => {
    const bindings = resolveHotkeys({
      SELECTION_TOOL: 'c',
    })

    expect(findHotkeyConflicts(bindings, 'c', 'SELECTION_TOOL')).toEqual(['RAZOR_TOOL'])
  })

  it('exposes derived preview variants that collide with runtime commands', () => {
    const bindings = resolveHotkeys()

    expect(findHotkeyConflicts(bindings, 'j', 'MARK_IN')).toContain('JOIN_ITEMS')
  })
})

describe('resolveHotkeyConfiguration', () => {
  it('keeps every runtime binding unique and falls back a conflicting override', () => {
    const result = resolveHotkeyConfiguration({ EDIT_KEYFRAME_ADD: 'k' })

    expect(result.bindings.SHUTTLE_PAUSE).toBe('k')
    expect(result.bindings.EDIT_KEYFRAME_ADD).toBe('shift+k')
    expect(result.overrides).toEqual({})
    expect(result.warnings).toEqual([
      {
        code: 'duplicate_binding',
        command: 'EDIT_KEYFRAME_ADD',
        binding: 'k',
        resolution: 'fallback',
        conflictingCommand: 'SHUTTLE_PAUSE',
      },
    ])
  })

  it('rejects an earlier override instead of disabling a later default command', () => {
    const result = resolveHotkeyConfiguration({ PLAY_PAUSE: 'k' })

    expect(result.bindings.PLAY_PAUSE).toBe('space')
    expect(result.bindings.SHUTTLE_PAUSE).toBe('k')
    expect(result.overrides).toEqual({})
    expect(result.warnings).toEqual([
      expect.objectContaining({
        command: 'PLAY_PAUSE',
        conflictingCommand: 'SHUTTLE_PAUSE',
        resolution: 'fallback',
      }),
    ])
  })

  it('accepts a conflict-free swap regardless of canonical command order', () => {
    const result = resolveHotkeyConfiguration({
      PLAY_PAUSE: 'k',
      SHUTTLE_PAUSE: 'space',
    })

    expect(result.bindings.PLAY_PAUSE).toBe('k')
    expect(result.bindings.SHUTTLE_PAUSE).toBe('space')
    expect(result.overrides).toEqual({ PLAY_PAUSE: 'k', SHUTTLE_PAUSE: 'space' })
    expect(result.warnings).toEqual([])
  })

  it('rejects a MARK_IN and shuttle reverse swap that derives the JOIN_ITEMS chord', () => {
    const result = resolveHotkeyConfiguration({
      MARK_IN: 'j',
      SHUTTLE_REVERSE: 'i',
    })

    expect(result.bindings.MARK_IN).toBe('i')
    expect(result.bindings.SHUTTLE_REVERSE).toBe('j')
    expect(result.bindings.JOIN_ITEMS).toBe('shift+j')
    expect(result.overrides).toEqual({})
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'MARK_IN',
          binding: 'shift+j',
          conflictingCommand: 'JOIN_ITEMS',
          resolution: 'fallback',
        }),
        expect.objectContaining({
          command: 'SHUTTLE_REVERSE',
          binding: 'i',
          conflictingCommand: 'MARK_IN',
          resolution: 'fallback',
        }),
      ]),
    )
  })

  it('keeps ordinary remaps whose direct and derived runtime chords are unique', () => {
    const result = resolveHotkeyConfiguration({
      MARK_IN: 'q',
      SHUTTLE_REVERSE: 'g',
    })

    expect(result.overrides).toEqual({ MARK_IN: 'q', SHUTTLE_REVERSE: 'g' })
    expect(result.warnings).toEqual([])
  })
})

describe('sanitizeHotkeyOverrides', () => {
  it('keeps only supported commands with normalized non-default bindings', () => {
    expect(
      sanitizeHotkeyOverrides({
        PLAY_PAUSE: ' Shift+Space ',
        EXPORT: 'Ctrl+E',
        UNKNOWN_COMMAND: 'q',
        DELETE_SELECTED: '',
      }),
    ).toEqual({
      PLAY_PAUSE: 'shift+space',
      EXPORT: 'mod+e',
      DELETE_SELECTED: '',
    })
  })

  it('migrates the legacy split-at-cursor command id', () => {
    expect(
      sanitizeHotkeyOverrides({
        SPLIT_AT_CURSOR: 'mod+shift+c',
      }),
    ).toEqual({
      SPLIT_AT_PLAYHEAD: 'mod+shift+c',
    })
  })
})

describe('createHotkeyExportDocument', () => {
  it('creates a versioned export with command metadata and sanitized overrides', () => {
    const exportDocument = createHotkeyExportDocument({
      PLAY_PAUSE: 'Shift+Space',
      EXPORT: 'Ctrl+E',
    })

    expect(exportDocument.schema).toBe(HOTKEY_EXPORT_SCHEMA)
    expect(exportDocument.version).toBe(HOTKEY_EXPORT_VERSION)
    expect(exportDocument.overrides).toEqual({
      PLAY_PAUSE: 'shift+space',
      EXPORT: 'mod+e',
    })
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'PLAY_PAUSE',
        label: 'Play/Pause',
        binding: 'shift+space',
        defaultBinding: 'space',
        isCustom: true,
      }),
    )
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'SHUTTLE_PAUSE',
        binding: 'k',
        defaultBinding: 'k',
      }),
    )
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'EXPORT',
        binding: 'mod+e',
        defaultBinding: 'mod+shift+e',
        isCustom: true,
      }),
    )
  })

  it('exports explicitly unassigned commands as custom blank bindings', () => {
    const exportDocument = createHotkeyExportDocument({
      DELETE_SELECTED: '',
    })

    expect(exportDocument.overrides).toEqual({
      DELETE_SELECTED: '',
    })
    expect(exportDocument.commands).toContainEqual(
      expect.objectContaining({
        id: 'DELETE_SELECTED',
        binding: '',
        defaultBinding: 'delete',
        isCustom: true,
      }),
    )
  })
})

describe('parseHotkeyImportDocument', () => {
  it('imports versioned override payloads and ignores unknown commands', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        overrides: {
          PLAY_PAUSE: 'Shift+Space',
          UNKNOWN_COMMAND: 'q',
        },
      }),
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
      },
      importedCommandCount: 1,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: 1,
    })
  })

  it('falls back to command entries when overrides are missing', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [
          { id: 'PLAY_PAUSE', binding: 'Shift+Space' },
          { id: 'EXPORT', binding: 'Ctrl+E' },
          { id: 'UNKNOWN_COMMAND', binding: 'q' },
        ],
      }),
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
        EXPORT: 'mod+e',
      },
      importedCommandCount: 2,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: 1,
    })
  })

  it('remaps renamed commands from exported metadata when ids no longer match', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [
          {
            id: 'PLAYBACK_TOGGLE_OLD',
            label: 'Play/Pause',
            defaultBinding: 'space',
            binding: 'Shift+Space',
          },
        ],
      }),
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
      },
      importedCommandCount: 1,
      ignoredCommandCount: 0,
      remappedCommandCount: 1,
      sourceVersion: 1,
    })
  })

  it('imports explicitly unassigned shortcuts', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [
          { id: 'PLAY_PAUSE', binding: '' },
          { id: 'EXPORT', binding: 'Ctrl+E' },
        ],
      }),
    ).toEqual({
      overrides: {
        PLAY_PAUSE: '',
        EXPORT: 'mod+e',
      },
      importedCommandCount: 2,
      ignoredCommandCount: 0,
      remappedCommandCount: 0,
      sourceVersion: 1,
    })
  })

  it('supports plain legacy key-binding maps', () => {
    expect(
      parseHotkeyImportDocument({
        PLAY_PAUSE: 'Shift+Space',
        EXPORT: 'Ctrl+E',
        DELETE_SELECTED: '',
        UNKNOWN_COMMAND: 'q',
      }),
    ).toEqual({
      overrides: {
        PLAY_PAUSE: 'shift+space',
        EXPORT: 'mod+e',
        DELETE_SELECTED: '',
      },
      importedCommandCount: 3,
      ignoredCommandCount: 1,
      remappedCommandCount: 0,
      sourceVersion: null,
    })
  })

  it('imports the renamed split command from a v1 preset', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        overrides: {
          SPLIT_AT_CURSOR: 'mod+shift+c',
        },
      }),
    ).toEqual({
      overrides: {
        SPLIT_AT_PLAYHEAD: 'mod+shift+c',
      },
      importedCommandCount: 1,
      ignoredCommandCount: 0,
      remappedCommandCount: 1,
      sourceVersion: 1,
    })
  })

  it('migrates the v1 plain-K keyframe default without recreating the transport conflict', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 1,
        commands: [{ id: 'EDIT_KEYFRAME_ADD', binding: 'k', defaultBinding: 'k' }],
      }),
    ).toEqual({
      overrides: {},
      importedCommandCount: 1,
      ignoredCommandCount: 0,
      remappedCommandCount: 0,
      sourceVersion: 1,
    })
  })

  it('falls back a v2 plain-K keyframe override that conflicts with transport', () => {
    expect(
      parseHotkeyImportDocument({
        schema: HOTKEY_EXPORT_SCHEMA,
        version: 2,
        overrides: {
          EDIT_KEYFRAME_ADD: 'k',
        },
      }),
    ).toEqual({
      overrides: {},
      importedCommandCount: 1,
      ignoredCommandCount: 0,
      remappedCommandCount: 0,
      sourceVersion: 2,
      conflictWarnings: [
        {
          code: 'duplicate_binding',
          command: 'EDIT_KEYFRAME_ADD',
          binding: 'k',
          resolution: 'fallback',
          conflictingCommand: 'SHUTTLE_PAUSE',
        },
      ],
    })
  })
})
