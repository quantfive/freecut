# FreeCut verification graph

Cross-feature couplings that break **silently** — i.e. not caught by the
typechecker or imports alone. Format per edge:
`<source> -> <target> | mechanism | how it breaks | check that catches it`.
Blast radius of an area: grep its name below. When a change touches any edge,
run the named check at the PR head.

## Edges

- `packages/freecut-editor/src -> src/features/editor/host` | the published
  package re-exports the real host surface (`FreeCutEditorSurface`,
  `EditorHostProvider`, `EditorHost` contract); a signature drift compiles in
  the repo but breaks installed consumers | `npm run test:editor-surface:consumer`
- `packages/freecut-editor package.json exports -> vite.editor-package.config.ts`
  | `main`/`module`/`types`/`./style.css` point at `dist/` names produced by
  the package build; renaming an output breaks consumers without any in-repo
  error | `npm run build:editor-surface && npm run test:editor-surface:consumer`
- `standalone app -> host surface` | the same editor surface runs with the
  standalone bootstrap (router, workspace, local project storage) that the
  package deliberately excludes; a surface change that silently depends on
  the bootstrap breaks the package, and vice versa | `npm run build` +
  `npm run build:editor-surface` + consumer smoke
- `src/headless (window.freecut API) -> headless/*.mjs harness` | the harness
  waits on `window.freecut.ready` and calls `renderTimeline`, `renderProject`,
  `renderFrame`, `dumpLayout`, `editProject`, `probeMedia` by name; a rename
  or readiness-change times out with no compile error | `npm run headless:test:chrome`,
  `npm run qa:browser`
- `codec capability override -> headless tests` | tests force codec fallback
  via the `globalThis.__freecutSupportedCodecsOverride` seam; removing or
  renaming the seam makes fallback coverage silently untestable |
  `node headless/test.mjs`
- `project schemaVersion -> project JSON fixtures` | saved projects, headless
  fixtures, and the consumer smoke fixture carry `schemaVersion`; a migration
  that changes semantics without bumping deserializes stale projects without
  error | `npm run test:run` + `node headless/test.mjs`
- `provenance/freecut-baseline.json -> package.json + package-lock.json +
  LICENSE + notices + tracked assets` | the manifest pins SHA256s of the
  upstream revision, dependency inventory, license/notice files, and asset
  roots; any drift fails only when the provenance gate runs |
  `npm run verify:provenance`
- `packages/freecut-editor consumer-smoke fixtures -> vite.editor-package.test.config.ts`
  | `scripts/test-editor-surface-consumer.mjs` copies the smoke
  test/setup/style-declaration plus the test vite config into a temp consumer;
  renaming any of those files breaks the smoke with a missing-file error only
  at run time | `npm run test:editor-surface:consumer`
- `headless/server.mjs harness contract -> headless tests + qa:browser` |
  `createHarnessServer({ distDir, resolveMedia })` returns
  `harnessUrl`/`mediaUrl(id)`; tests and the browser QA script both consume
  that shape | `npm run headless:test:node` + `npm run qa:browser`
- `fallow allowlists (scripts/*.allowlist.json) -> unused-export/member gates`
  | the allowlists are ratchet baselines; editing them to silence a new
  finding hides real dead code | `npm run check:unused-exports`,
  `npm run check:unused-class-members`
- `feature-edge budgets -> feature boundaries` | `check:edge-budgets` caps
  cross-feature import edges; growing an edge count past the budget fails
  only when the budget gate runs | `npm run check:edge-budgets`
