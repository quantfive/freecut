// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  RUNTIME_HOTKEY_ADAPTER_PATH,
  findReactHotkeysHookImportViolations,
} from '../../scripts/runtime-hotkey-import-boundary.mjs'

const BOUNDARY_SCRIPT = join(process.cwd(), 'scripts/runtime-hotkey-import-boundary.mjs')

const ROLLDOWN_PARITY_CASES = [
  {
    name: 'function-local const',
    source: "export function load() { const pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'shadowed parameter',
    source:
      "const pkg = 'react-hotkeys-hook'; export function load(pkg: string) { return import(pkg) }",
    resolves: false,
  },
  {
    name: 'nested block const',
    source:
      "export function load() { if (true) { const pkg = 'react-hotkeys-hook'; return import(pkg) } }",
    resolves: true,
  },
  {
    name: 'catch destructuring shadow',
    source:
      "const pkg = 'react-hotkeys-hook'; export function load() { try { throw { pkg: 'dynamic' } } catch ({ pkg }) { return import(pkg) } }",
    resolves: false,
  },
  {
    name: 'const alias chain',
    source:
      "export function load() { const prefix = 'react-'; const suffix = 'hotkeys-hook'; const pkg = prefix + suffix; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'nested block alias chain',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; { const alias = pkg; return import(alias) } }",
    resolves: true,
  },
  {
    name: 'shadowed alias initializer reference',
    source:
      "declare function moduleName(): string; export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { const pkg = moduleName(); return import(alias) } }",
    resolves: false,
  },
  {
    name: 'declaration environment alias',
    source:
      "declare function moduleName(): string; export function load() { const pkg = moduleName(); const alias = pkg; { const pkg = 'react-hotkeys-hook'; return import(alias) } }",
    resolves: false,
  },
  {
    name: 'outer function boundary const',
    source: "const pkg = 'react-hotkeys-hook'; export function load() { return import(pkg) }",
    resolves: false,
  },
  {
    name: 'outer class boundary const',
    source: "const pkg = 'react-hotkeys-hook'; export class Loader { static load = import(pkg) }",
    resolves: false,
  },
  {
    name: 'loop-header const',
    source:
      "export function load() { for (const pkg = 'react-hotkeys-hook'; ;) return import(pkg) }",
    resolves: false,
  },
  {
    name: 'const alias cycle',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; { const pkg = pkg; return import(pkg) } }",
    resolves: false,
  },
  {
    name: 'unknown const initializer',
    source:
      "declare function moduleName(): string; export function load() { const pkg = 'react-hotkeys-hook'; { const pkg = moduleName(); return import(pkg) } }",
    resolves: false,
  },
] as const

const ROLLDOWN_PARITY_SCRIPT = `
  import { rolldown, VERSION } from 'rolldown'

  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const sources = JSON.parse(input)
  const resolutions = []

  for (const [index, source] of sources.entries()) {
    const entry = \`virtual:runtime-hotkey-boundary-\${index}.ts\`
    const bundle = await rolldown({
      input: entry,
      external: ['react-hotkeys-hook'],
      plugins: [{
        name: 'runtime-hotkey-boundary-memory-fixture',
        resolveId(id) { if (id === entry) return id },
        load(id) { if (id === entry) return source },
      }],
    })

    try {
      const generated = await bundle.generate({ format: 'es' })
      const chunk = generated.output.find((output) => output.type === 'chunk')
      if (!chunk) throw new Error('Rolldown did not generate a JavaScript chunk')
      resolutions.push(/import\\(["']react-hotkeys-hook["']\\)/.test(chunk.code))
    } finally {
      await bundle.close()
    }
  }

  process.stdout.write(JSON.stringify({ version: VERSION, resolutions }))
`

function runRolldownParityFixtures(sources: readonly string[]) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', ROLLDOWN_PARITY_SCRIPT],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      input: JSON.stringify(sources),
    },
  )
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Rolldown parity process failed')
  }
  return JSON.parse(result.stdout) as { version: string; resolutions: boolean[] }
}

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

  it('detects a function-local lexical const resolved by Rolldown', () => {
    const localConst =
      "export function load() { const pkg = 'react-hotkeys-hook'; return import(pkg) }"

    expect(
      findReactHotkeysHookImportViolations([
        { path: 'src/features/function-local.ts', source: localConst },
      ]),
    ).toEqual([expect.objectContaining({ path: 'src/features/function-local.ts' })])
  })

  it('does not fall through a shadowed lexical parameter Rolldown keeps dynamic', () => {
    const shadowedParameter =
      "const pkg = 'react-hotkeys-hook'; export function load(pkg: string) { return import(pkg) }"

    expect(
      findReactHotkeysHookImportViolations([
        { path: 'src/features/shadowed-parameter.ts', source: shadowedParameter },
      ]),
    ).toEqual([])
  })

  it('matches Rolldown constant folding across lexical scopes and shadow barriers', () => {
    const parity = runRolldownParityFixtures(ROLLDOWN_PARITY_CASES.map(({ source }) => source))
    expect(parity.version).toBe('1.1.5')
    expect(parity.resolutions).toHaveLength(ROLLDOWN_PARITY_CASES.length)

    for (const [index, fixture] of ROLLDOWN_PARITY_CASES.entries()) {
      const checkerResolves =
        findReactHotkeysHookImportViolations([
          { path: `src/features/${fixture.name.replaceAll(' ', '-')}.ts`, source: fixture.source },
        ]).length === 1
      const rolldownResolves = parity.resolutions[index]

      expect(rolldownResolves, `${fixture.name}: Rolldown fixture expectation`).toBe(
        fixture.resolves,
      )
      expect(checkerResolves, `${fixture.name}: checker/Rolldown parity`).toBe(rolldownResolves)
    }
  })

  it('predeclares every lexical shadow barrier before resolving identifier imports', () => {
    const fixtures: Array<[string, string]> = [
      [
        'let-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); let pkg }",
      ],
      [
        'var-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); var pkg }",
      ],
      [
        'nested-var-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load() { { import(pkg) } if (true) { var pkg } }",
      ],
      [
        'destructuring-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load(value: { pkg: string }) { import(pkg); const { pkg } = value }",
      ],
      ['import-binding', "import pkg from './runtime-name'; export const load = () => import(pkg)"],
      [
        'import-equals-binding',
        "const pkg = 'react-hotkeys-hook'; declare namespace Runtime { const pkg: string } namespace Loader { import pkg = Runtime.pkg; export const load = () => import(pkg) }",
      ],
      [
        'class-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); class pkg {} }",
      ],
      [
        'function-after-import',
        "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); function pkg() {} }",
      ],
      [
        'const-without-initializer',
        "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); const pkg: string }",
      ],
      [
        'loop-destructuring',
        "const pkg = 'react-hotkeys-hook'; export function load(values: Array<{ pkg: string }>) { for (const { pkg } of values) import(pkg) }",
      ],
    ]

    expect(
      findReactHotkeysHookImportViolations(
        fixtures.map(([name, source]) => ({ path: `src/features/${name}.ts`, source })),
      ),
    ).toEqual([])
  })

  it("evaluates a const initializer in its declaration's lexical environment", () => {
    const source =
      "declare function moduleName(): string; export function load() { const pkg = moduleName(); const alias = pkg; { const pkg = 'react-hotkeys-hook'; return import(alias) } }"

    expect(
      findReactHotkeysHookImportViolations([
        { path: 'src/features/declaration-environment.ts', source },
      ]),
    ).toEqual([])
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
