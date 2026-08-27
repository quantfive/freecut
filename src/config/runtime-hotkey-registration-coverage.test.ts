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
    name: 'function-local let initializer',
    source: "export function load() { let pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'function-local var initializer',
    source: "export function load() { var pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'function-local let simple assignment',
    source: "export function load() { let pkg; pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'function-local var simple assignment',
    source: "export function load() { var pkg; pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: true,
  },
  {
    name: 'function owner inside dynamic branch',
    source:
      "declare const enabled: boolean; if (enabled) { function load() { let pkg; pkg = 'react-hotkeys-hook'; return import(pkg) } load() }",
    resolves: true,
  },
  {
    name: 'class owner inside dynamic branch',
    source:
      "declare const enabled: boolean; if (enabled) { class Loader { static { let pkg; pkg = 'react-hotkeys-hook'; import(pkg) } } new Loader() }",
    resolves: true,
  },
  {
    name: 'mutable statically true branch write',
    source: "let pkg; if (true) pkg = 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'mutable statically false else write',
    source: "let pkg; if (false) pkg = 'other'; else pkg = 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'mutable dead branch reassignment',
    source: "let pkg = 'react-hotkeys-hook'; if (false) pkg = 'other'; import(pkg)",
    resolves: true,
  },
  {
    name: 'mutable statically executed logical write',
    source: "let pkg; true && (pkg = 'react-hotkeys-hook'); import(pkg)",
    resolves: true,
  },
  {
    name: 'mutable statically selected conditional write',
    source: "let pkg; true ? pkg = 'react-hotkeys-hook' : pkg = 'other'; import(pkg)",
    resolves: true,
  },
  {
    name: 'var assignment before declaration',
    source: "pkg = 'react-hotkeys-hook'; var pkg; import(pkg)",
    resolves: false,
  },
  {
    name: 'let assignment before declaration',
    source: "pkg = 'react-hotkeys-hook'; let pkg; import(pkg)",
    resolves: false,
  },
  {
    name: 'mutable read before assignment',
    source: "export function load() { let pkg; import(pkg); pkg = 'react-hotkeys-hook' }",
    resolves: false,
  },
  {
    name: 'mutable reassignment before use',
    source:
      "export function load() { let pkg = 'react-hotkeys-hook'; pkg = 'other'; return import(pkg) }",
    resolves: false,
  },
  {
    name: 'mutable reassignment after use',
    source: "export function load() { let pkg = 'react-hotkeys-hook'; import(pkg); pkg = 'other' }",
    resolves: false,
  },
  {
    name: 'mutable branch write',
    source:
      "declare const enabled: boolean; export function load() { let pkg; if (enabled) pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: false,
  },
  {
    name: 'mutable loop write',
    source:
      "declare const enabled: boolean; export function load() { let pkg; while (enabled) pkg = 'react-hotkeys-hook'; return import(pkg) }",
    resolves: false,
  },
  {
    name: 'mutable exception-path write',
    source:
      "export function load() { let pkg; try { pkg = 'react-hotkeys-hook' } finally {} return import(pkg) }",
    resolves: false,
  },
  {
    name: 'mutable unknown write',
    source:
      "declare function moduleName(): string; export function load() { let pkg = 'react-hotkeys-hook'; pkg = moduleName(); return import(pkg) }",
    resolves: false,
  },
  {
    name: 'mutable nested block assignment',
    source: "export function load() { let pkg; { pkg = 'react-hotkeys-hook' } return import(pkg) }",
    resolves: true,
  },
  {
    name: 'mutable alias after assignment',
    source:
      "export function load() { let pkg; pkg = 'react-hotkeys-hook'; const alias = pkg; return import(alias) }",
    resolves: true,
  },
  {
    name: 'mutable alias before assignment',
    source:
      "export function load() { let pkg; const alias = pkg; pkg = 'react-hotkeys-hook'; return import(alias) }",
    resolves: false,
  },
  {
    name: 'mutable alias captured before later write',
    source:
      "export function load() { let pkg = 'react-hotkeys-hook'; const alias = pkg; pkg = 'other'; return import(alias) }",
    resolves: false,
  },
  {
    name: 'mutable closure uncertainty',
    source:
      "export function load() { let pkg = 'react-hotkeys-hook'; const inner = () => import(pkg); return inner }",
    resolves: false,
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
    name: 'same-value nested shadow alias',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { const pkg = 'react-hotkeys-hook'; return import(alias) } }",
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
    name: 'enclosing catch const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; try { throw 1 } catch { return import(pkg) } }",
    resolves: false,
  },
  {
    name: 'catch-local const',
    source:
      "export function load() { try { throw 1 } catch { const pkg = 'react-hotkeys-hook'; return import(pkg) } }",
    resolves: true,
  },
  {
    name: 'catch-local alias chain',
    source:
      "export function load() { try { throw 1 } catch { const pkg = 'react-hotkeys-hook'; const alias = pkg; return import(alias) } }",
    resolves: true,
  },
  {
    name: 'catch-local alias cycle',
    source:
      'export function load() { try { throw 1 } catch { const pkg = pkg; return import(pkg) } }',
    resolves: false,
  },
  {
    name: 'classic for initializer outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (import(pkg); ;) break }",
    resolves: true,
  },
  {
    name: 'classic for condition outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (; import(pkg); ) break }",
    resolves: false,
  },
  {
    name: 'classic for update outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (; ; import(pkg)) break }",
    resolves: false,
  },
  {
    name: 'classic for body outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (;;) { import(pkg); break } }",
    resolves: false,
  },
  {
    name: 'classic for body local const',
    source:
      "export function load() { for (;;) { const pkg = 'react-hotkeys-hook'; import(pkg); break } }",
    resolves: true,
  },
  {
    name: 'classic for body local alias cycle',
    source: 'export function load() { for (;;) { const pkg = pkg; import(pkg); break } }',
    resolves: false,
  },
  {
    name: 'for-in expression outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const key in import(pkg)) void key }",
    resolves: true,
  },
  {
    name: 'for-in body outer const',
    source:
      "export function load(values: object) { const pkg = 'react-hotkeys-hook'; for (const key in values) import(pkg) }",
    resolves: false,
  },
  {
    name: 'for-in body local const',
    source:
      "export function load(values: object) { for (const key in values) { const pkg = 'react-hotkeys-hook'; import(pkg) } }",
    resolves: true,
  },
  {
    name: 'for-of expression outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const value of import(pkg)) void value }",
    resolves: true,
  },
  {
    name: 'for-of body outer const',
    source:
      "export function load(values: unknown[]) { const pkg = 'react-hotkeys-hook'; for (const value of values) import(pkg) }",
    resolves: false,
  },
  {
    name: 'for-of body local const',
    source:
      "export function load(values: unknown[]) { for (const value of values) { const pkg = 'react-hotkeys-hook'; import(pkg) } }",
    resolves: true,
  },
  {
    name: 'while condition outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; while (import(pkg)) break }",
    resolves: false,
  },
  {
    name: 'while body outer const',
    source:
      "export function load(active: boolean) { const pkg = 'react-hotkeys-hook'; while (active) { import(pkg); break } }",
    resolves: false,
  },
  {
    name: 'while body local const',
    source:
      "export function load(active: boolean) { while (active) { const pkg = 'react-hotkeys-hook'; import(pkg); break } }",
    resolves: true,
  },
  {
    name: 'do-while condition outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; do {} while (import(pkg)) }",
    resolves: false,
  },
  {
    name: 'do-while body outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; do { import(pkg) } while (false) }",
    resolves: false,
  },
  {
    name: 'do-while body local const',
    source:
      "export function load() { do { const pkg = 'react-hotkeys-hook'; import(pkg) } while (false) }",
    resolves: true,
  },
  {
    name: 'direct const temporal dead zone',
    source: "export function load() { import(pkg); const pkg = 'react-hotkeys-hook' }",
    resolves: false,
  },
  {
    name: 'alias initializer temporal dead zone',
    source:
      "export function load() { const alias = pkg; const pkg = 'react-hotkeys-hook'; import(alias) }",
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
  {
    name: 'captured alias under different literal shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { const pkg = 'other'; return import(alias) } }",
    resolves: true,
  },
  {
    name: 'captured alias under uninitialized let shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { let pkg; return import(alias) } }",
    resolves: true,
  },
  {
    name: 'captured alias under unknown let shadow',
    source:
      "declare function moduleName(): string; export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { let pkg = moduleName(); return import(alias) } }",
    resolves: false,
  },
  {
    name: 'captured alias under mutated let shadow',
    source:
      "declare function moduleName(): string; export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { let pkg; pkg = moduleName(); return import(alias) } }",
    resolves: false,
  },
  {
    name: 'captured alias under function shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { function pkg() {} return import(alias) } }",
    resolves: true,
  },
  {
    name: 'captured alias under class shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { class pkg {} return import(alias) } }",
    resolves: true,
  },
  {
    name: 'captured alias with unknown sibling shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { const pkg = moduleName() } { return import(alias) } }",
    resolves: false,
  },
  {
    name: 'captured alias with known sibling shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; { const pkg = 'other' } { return import(alias) } }",
    resolves: true,
  },
  {
    name: 'captured alias across closure parameter',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; return function inner(pkg: string) { return import(alias) } }",
    resolves: false,
  },
  {
    name: 'direct let shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; { let pkg; return import(pkg) } }",
    resolves: false,
  },
  {
    name: 'direct var shadow',
    source:
      "const pkg = 'react-hotkeys-hook'; export function load() { import(pkg); var pkg: string }",
    resolves: false,
  },
  {
    name: 'direct destructuring shadow',
    source:
      "export function load(value: { pkg: string }) { const pkg = 'react-hotkeys-hook'; { const { pkg } = value; return import(pkg) } }",
    resolves: false,
  },
  {
    name: 'direct import binding shadow',
    source: "import pkg from 'runtime-name'; export function load() { return import(pkg) }",
    resolves: false,
  },
  {
    name: 'direct function shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; { return import(pkg); function pkg() {} } }",
    resolves: false,
  },
  {
    name: 'direct class shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; { return import(pkg); class pkg {} } }",
    resolves: false,
  },
  {
    name: 'finally outer const',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; try {} finally { return import(pkg) } }",
    resolves: true,
  },
  {
    name: 'finally captured alias under let shadow',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; try {} finally { let pkg; return import(alias) } }",
    resolves: true,
  },
  {
    name: 'catch captured alias boundary',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; const alias = pkg; try { throw 1 } catch { return import(alias) } }",
    resolves: false,
  },
  {
    name: 'classic for sequential declarator',
    source:
      "export function load() { for (const pkg = 'react-hotkeys-hook', pending = import(pkg); ;) break }",
    resolves: true,
  },
  {
    name: 'classic for later declarator temporal dead zone',
    source:
      "export function load() { for (const pending = import(pkg), pkg = 'react-hotkeys-hook'; ;) break }",
    resolves: false,
  },
  {
    name: 'classic for current declarator temporal dead zone',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const pkg = import(pkg); ;) break }",
    resolves: false,
  },
  {
    name: 'for-in same-name expression temporal dead zone',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const pkg in import(pkg)) break }",
    resolves: false,
  },
  {
    name: 'for-of same-name expression temporal dead zone',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const pkg of import(pkg)) break }",
    resolves: false,
  },
  {
    name: 'for-in different-name expression',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const key in import(pkg)) break }",
    resolves: true,
  },
  {
    name: 'for-of different-name expression',
    source:
      "export function load() { const pkg = 'react-hotkeys-hook'; for (const value of import(pkg)) break }",
    resolves: true,
  },
  {
    name: 'conditional true branch',
    source: "const pkg = true ? 'react-hotkeys-hook' : 'other'; import(pkg)",
    resolves: true,
  },
  {
    name: 'conditional false branch',
    source: "const pkg = false ? 'other' : 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'conditional non-target result',
    source: "const pkg = true ? 'other' : 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'conditional unknown condition',
    source:
      "declare const enabled: boolean; const pkg = enabled ? 'react-hotkeys-hook' : 'other'; import(pkg)",
    resolves: true,
  },
  {
    name: 'conditional wholly dynamic result',
    source:
      'declare const enabled: boolean; declare const first: string; declare const second: string; const pkg = enabled ? first : second; import(pkg)',
    resolves: false,
  },
  {
    name: 'logical and truthy boolean',
    source: "const pkg = true && 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'logical and truthy number',
    source: "const pkg = 1 && 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'logical and falsy boolean',
    source: "const pkg = false && 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'logical and falsy number',
    source: "const pkg = 0 && 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'logical or falsy boolean',
    source: "const pkg = false || 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'logical or falsy number',
    source: "const pkg = 0 || 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'logical or truthy boolean',
    source: "const pkg = true || 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'logical or truthy string',
    source: "const pkg = 'other' || 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'nullish null',
    source: "const pkg = null ?? 'react-hotkeys-hook'; import(pkg)",
    resolves: true,
  },
  {
    name: 'nullish non-null number',
    source: "const pkg = 0 ?? 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'unknown logical operand',
    source:
      "declare const enabled: boolean; const pkg = enabled && 'react-hotkeys-hook'; import(pkg)",
    resolves: false,
  },
  {
    name: 'unknown concatenated operand',
    source: "declare const suffix: string; const pkg = 'react-hotkeys-' + suffix; import(pkg)",
    resolves: false,
  },
  {
    name: 'wrapped logical expression',
    source:
      "const pkg = (((true && 'react-hotkeys-hook') as string)!) satisfies string; import(pkg)",
    resolves: true,
  },
  {
    name: 'const enum property member',
    source: "const enum Modules { Hotkeys = 'react-hotkeys-hook' } import(Modules.Hotkeys)",
    resolves: true,
  },
  {
    name: 'const enum element member',
    source: "const enum Modules { Hotkeys = 'react-hotkeys-hook' } import(Modules['Hotkeys'])",
    resolves: true,
  },
  {
    name: 'const enum member alias',
    source:
      "const enum Modules { Hotkeys = 'react-hotkeys-hook', Alias = Hotkeys } import(Modules.Alias)",
    resolves: true,
  },
  {
    name: 'const enum non-target member',
    source:
      "const enum Modules { Hotkeys = 'react-hotkeys-hook', Other = 'other' } import(Modules.Other)",
    resolves: false,
  },
  {
    name: 'const enum automatic numeric member',
    source: 'const enum Modules { Other } import(Modules.Other)',
    resolves: false,
  },
  {
    name: 'const enum member cycle',
    source: 'const enum Modules { First = Second, Second = First } import(Modules.First)',
    resolves: false,
  },
  {
    name: 'global require',
    source: "export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'type-only named require binding',
    source:
      "import { type require } from 'runtime-name'; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'type-only default require binding',
    source:
      "import type require from 'runtime-name'; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'type-only namespace require binding',
    source:
      "import type * as require from 'runtime-name'; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'type-only import does not shadow package binding',
    source:
      "const pkg = 'react-hotkeys-hook'; import type { pkg } from 'runtime-name'; import(pkg)",
    resolves: true,
  },
  {
    name: 'mixed value import still shadows require',
    source:
      "import { type Other, require } from 'runtime-name'; export function load() { return require('react-hotkeys-hook') }",
    resolves: false,
  },
  {
    name: 'ambient function require binding',
    source:
      "declare function require(id: string): unknown; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'ambient const require binding',
    source:
      "declare const require: (id: string) => unknown; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'ambient let require binding',
    source:
      "declare let require: (id: string) => unknown; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'ambient var require binding',
    source:
      "declare var require: (id: string) => unknown; export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'ambient class require binding',
    source:
      "declare class require {} export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'ambient namespace require binding',
    source:
      "declare namespace require {} export function load() { return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'require parameter shadow',
    source:
      "export function load(require: (id: string) => unknown) { return require('react-hotkeys-hook') }",
    resolves: false,
  },
  {
    name: 'require destructuring parameter shadow',
    source:
      "export function load({ require }: { require: (id: string) => unknown }) { return require('react-hotkeys-hook') }",
    resolves: false,
  },
  {
    name: 'require local const shadow',
    source:
      "export function load() { const require = (id: string) => id; return require('react-hotkeys-hook') }",
    resolves: false,
  },
  {
    name: 'require local function shadow',
    source:
      "export function load() { return require('react-hotkeys-hook'); function require(id: string) { return id } }",
    resolves: false,
  },
  {
    name: 'require import shadow',
    source:
      "import { require } from 'runtime-name'; export function load() { return require('react-hotkeys-hook') }",
    resolves: false,
  },
  {
    name: 'require catch shadow',
    source:
      "export function load() { try { throw (() => undefined) } catch (require) { return require('react-hotkeys-hook') } }",
    resolves: false,
  },
  {
    name: 'require sibling unshadowed',
    source:
      "export function load() { { const require = (id: string) => id; require('react-hotkeys-hook') } return require('react-hotkeys-hook') }",
    resolves: true,
  },
  {
    name: 'type-only import declaration',
    source: "import type { HotkeyCallback } from 'react-hotkeys-hook'",
    resolves: false,
  },
  {
    name: 'type-only import specifier',
    source: "import { type HotkeyCallback } from 'react-hotkeys-hook'",
    resolves: false,
  },
  {
    name: 'mixed value and type import',
    source:
      "import { type HotkeyCallback, useHotkeys } from 'react-hotkeys-hook'; console.log(useHotkeys)",
    resolves: true,
  },
  {
    name: 'type-only export declaration',
    source: "export type { HotkeyCallback } from 'react-hotkeys-hook'",
    resolves: false,
  },
  {
    name: 'type-only export specifier',
    source: "export { type HotkeyCallback } from 'react-hotkeys-hook'",
    resolves: false,
  },
  {
    name: 'mixed value and type export',
    source: "export { type HotkeyCallback, useHotkeys } from 'react-hotkeys-hook'",
    resolves: true,
  },
  {
    name: 'type-only import equals',
    source: "import type Hotkeys = require('react-hotkeys-hook')",
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
      resolutions.push(
        /(?:from\\s+|import\\s*\\(|import\\s+|__require\\s*\\()\\s*["']react-hotkeys-hook["']/.test(
          chunk.code,
        ),
      )
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

    const mismatches: string[] = []
    for (const [index, fixture] of ROLLDOWN_PARITY_CASES.entries()) {
      const checkerResolves =
        findReactHotkeysHookImportViolations([
          { path: `src/features/${fixture.name.replaceAll(' ', '-')}.ts`, source: fixture.source },
        ]).length === 1
      const rolldownResolves = parity.resolutions[index]

      expect(rolldownResolves, `${fixture.name}: Rolldown fixture expectation`).toBe(
        fixture.resolves,
      )
      if (checkerResolves !== rolldownResolves) {
        mismatches.push(`${fixture.name}: checker=${checkerResolves}, Rolldown=${rolldownResolves}`)
      }
    }
    expect(mismatches).toEqual([])
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

  it('fails transparently and deterministically on malformed source', () => {
    const sources = [
      {
        path: 'src/features/z-malformed.ts',
        source: "const hooks = import('react-hotkeys-hook'",
      },
      { path: 'src/features/a-malformed.ts', source: 'export const value = }' },
    ]

    expect(() => findReactHotkeysHookImportViolations(sources)).toThrowError(
      new SyntaxError(
        'Runtime hotkey import boundary could not parse source:\n' +
          'src/features/a-malformed.ts:1:22 TS1109: Expression expected.\n' +
          "src/features/z-malformed.ts:1:42 TS1005: ')' expected.",
      ),
    )
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
