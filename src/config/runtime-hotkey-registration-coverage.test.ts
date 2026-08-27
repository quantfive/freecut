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

describe('runtime hotkey registration coverage', () => {
  it('allows react-hotkeys-hook only in the production registration adapter', () => {
    const sources = productionSourceFiles(SRC_ROOT).map((path) => ({
      path: relative(process.cwd(), path),
      source: readFileSync(path, 'utf8'),
    }))

    expect(findReactHotkeysHookImportViolations(sources)).toEqual([])
  })

  it.each([
    ['aliased static import', "import { useHotkeys as register } from 'react-hotkeys-hook'"],
    ['default import', "import hotkeyHooks from 'react-hotkeys-hook'"],
    ['namespace import', "import * as hotkeyHooks from 'react-hotkeys-hook'"],
    ['destructured require', "const { useHotkeys } = require('react-hotkeys-hook')"],
    ['TypeScript import-equals', "import hotkeyHooks = require('react-hotkeys-hook')"],
    ['wrapper re-export', "export { useHotkeys as useWrappedHotkey } from 'react-hotkeys-hook'"],
    ['dynamic import', "const hooks = await import('react-hotkeys-hook')"],
  ])('rejects a %s bypass', (_label, source) => {
    expect(
      findReactHotkeysHookImportViolations([{ path: 'src/features/bypass.ts', source }]),
    ).toEqual([expect.objectContaining({ path: 'src/features/bypass.ts', line: 1 })])
  })

  it('allows the exact adapter module and no similarly named wrapper', () => {
    const source = "import { useHotkeys } from 'react-hotkeys-hook'"
    expect(
      findReactHotkeysHookImportViolations([{ path: RUNTIME_HOTKEY_ADAPTER_PATH, source }]),
    ).toEqual([])
    expect(
      findReactHotkeysHookImportViolations([
        { path: 'src/hooks/use-hotkey-registration-wrapper.ts', source },
      ]),
    ).toHaveLength(1)
  })
})
