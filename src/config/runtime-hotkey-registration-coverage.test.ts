// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  RUNTIME_HOTKEY_ADAPTER_PATH,
  findReactHotkeysHookImportViolations,
} from '../../scripts/runtime-hotkey-import-boundary.mjs'

const BOUNDARY_SCRIPT = join(process.cwd(), 'scripts/runtime-hotkey-import-boundary.mjs')

describe('runtime hotkey registration coverage', () => {
  it('checks the full source tree in a standalone Node process', () => {
    const startedAt = performance.now()
    const result = spawnSync(process.execPath, [BOUNDARY_SCRIPT], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    const elapsedMs = performance.now() - startedAt

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain(`allowed adapter: ${RUNTIME_HOTKEY_ADAPTER_PATH}`)
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('rejects in-memory AST fixtures for every supported bypass form', () => {
    const fixtures: Array<[string, string]> = [
      ['escaped-static-import', "import 'react-hotkeys-\\u0068ook'"],
      ['side-effect-static-import', "import 'react-hotkeys-hook'"],
      ['aliased-static-import', "import { useHotkeys as register } from 'react-hotkeys-hook'"],
      ['default-import', "import hotkeyHooks from 'react-hotkeys-hook'"],
      ['namespace-import', "import * as hotkeyHooks from 'react-hotkeys-hook'"],
      ['destructured-require', "const { useHotkeys } = require('react-hotkeys-hook')"],
      ['typescript-import-equals', "import hotkeyHooks = require('react-hotkeys-hook')"],
      ['wrapper-re-export', "export { useHotkeys as useWrappedHotkey } from 'react-hotkeys-hook'"],
      ['export-all', "export * from 'react-hotkeys-hook'"],
      ['dynamic-import', "const hooks = await import('react-hotkeys-hook')"],
      ['template-dynamic-import', 'const hooks = await import(`react-hotkeys-hook`)'],
      ['interpolated-constant-template', "const hooks = await import(`react-${'hotkeys-'}hook`)"],
      ['concatenated-dynamic-import', "const hooks = await import('react-hotkeys-' + 'hook')"],
      ['nested-parentheses', "const hooks = await import(((('react-hotkeys-') + ('hook'))))"],
      [
        'typescript-expression-wrappers',
        "const hooks = await import((('react-hotkeys-' as string) + ('hook' satisfies string)))",
      ],
      [
        'verified-rolldown-const-identifier',
        "const moduleName = 'react-hotkeys-hook'; const hooks = await import(moduleName)",
      ],
    ]
    const sources = fixtures.map(([name, source]) => ({
      path: `src/features/${name}.ts`,
      source,
    }))

    expect(findReactHotkeysHookImportViolations(sources)).toEqual(
      sources
        .toSorted((left, right) => left.path.localeCompare(right.path))
        .map(({ path }) =>
          expect.objectContaining({ path, line: 1, allowedPath: RUNTIME_HOTKEY_ADAPTER_PATH }),
        ),
    )
  })

  it('does not trap text or non-constant module expressions', () => {
    const source = `
      // import('react-hotkeys-hook')
      const documentation = "require('react-hotkeys-hook')"
      const moduleName = getModuleName()
      const hooks = await import(moduleName)
    `

    expect(
      findReactHotkeysHookImportViolations([{ path: 'src/features/documentation.ts', source }]),
    ).toEqual([])
  })

  it('reports the exact source location and allowed adapter', () => {
    const path = 'src/features/multiline-import.ts'
    const source = "// setup\nconst hooks = await import('react-hotkeys-hook')"

    expect(findReactHotkeysHookImportViolations([{ path, source }])).toEqual([
      {
        path,
        line: 2,
        column: 21,
        allowedPath: RUNTIME_HOTKEY_ADAPTER_PATH,
        message: `${path}:2:21 imports react-hotkeys-hook; use ${RUNTIME_HOTKEY_ADAPTER_PATH}`,
      },
    ])
  })

  it('allows the exact adapter module and no similarly named wrapper', () => {
    const source = "import { useHotkeys } from 'react-hotkeys-hook'"
    expect(
      findReactHotkeysHookImportViolations([{ path: RUNTIME_HOTKEY_ADAPTER_PATH, source }]),
    ).toEqual([])
    const wrapperPath = 'src/hooks/use-hotkey-registration-wrapper.ts'
    expect(
      findReactHotkeysHookImportViolations([
        { path: RUNTIME_HOTKEY_ADAPTER_PATH, source },
        { path: wrapperPath, source },
      ]),
    ).toEqual([
      expect.objectContaining({
        path: wrapperPath,
        allowedPath: RUNTIME_HOTKEY_ADAPTER_PATH,
        message: expect.stringContaining(RUNTIME_HOTKEY_ADAPTER_PATH),
      }),
    ])
  })
})
