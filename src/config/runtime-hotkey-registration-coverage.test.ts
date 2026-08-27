// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  RUNTIME_HOTKEY_ADAPTER_PATH,
  findReactHotkeysHookImportViolations,
} from '../../scripts/runtime-hotkey-import-boundary.mjs'

const SRC_ROOT = join(process.cwd(), 'src')

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return []
    return [path]
  })
}

function formatViolations(
  violations: ReturnType<typeof findReactHotkeysHookImportViolations>,
): string {
  return violations.length === 0
    ? 'No runtime hotkey import violations'
    : violations.map(({ message }) => message).join('\n')
}

describe('runtime hotkey registration coverage', () => {
  it('allows react-hotkeys-hook only in the production registration adapter', () => {
    const sources = productionSourceFiles(SRC_ROOT).map((path) => ({
      path: relative(process.cwd(), path),
      source: readFileSync(path, 'utf8'),
    }))

    const violations = findReactHotkeysHookImportViolations(sources)
    expect(violations, formatViolations(violations)).toEqual([])
  })

  it('rejects in-memory AST fixtures for every supported bypass form', () => {
    const fixtures: Array<[string, string]> = [
      ['side-effect-static-import', "import 'react-hotkeys-hook'"],
      ['aliased-static-import', "import { useHotkeys as register } from 'react-hotkeys-hook'"],
      ['default-import', "import hotkeyHooks from 'react-hotkeys-hook'"],
      ['namespace-import', "import * as hotkeyHooks from 'react-hotkeys-hook'"],
      ['destructured-require', "const { useHotkeys } = require('react-hotkeys-hook')"],
      ['typescript-import-equals', "import hotkeyHooks = require('react-hotkeys-hook')"],
      ['wrapper-re-export', "export { useHotkeys as useWrappedHotkey } from 'react-hotkeys-hook'"],
      ['export-all', "export * from 'react-hotkeys-hook'"],
      ['dynamic-import', "const hooks = await import('react-hotkeys-hook')"],
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
