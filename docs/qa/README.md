# FreeCut QA Gates

FreeCut's QA gate set mirrors the CodePress delivery gates. Every PR to
`staging` must run the full gate set at its **exact head** and post a
[canonical QA report](./canonical-report.md) as a PR comment. A PR stays
**DRAFT** until a trusted judge returns PASS — no self-merge, no report
comment or evaluator may mark a PR ready.

## Docs-first rule

Before touching any area, read its doc: `docs/` for packaging/provenance and
render decomposition, `packages/freecut-editor/README.md` for the published
editor surface, `headless/` sources for the browser harness, and this
directory for the QA gates themselves. Cross-feature couplings that break
silently are recorded in [verification-graph.md](./verification-graph.md) —
check your blast radius there before and after a change.

## The gate set

Run everything at the PR head, from a clean tree, in this order:

| # | Gate | Command | Notes |
|---|------|---------|-------|
| 1 | Head binding | `npm run qa:binding -- --check` | Emits/validates the exact base/head + dirty-tree block for the report |
| 2 | Type check | `npm run check` | Focused: `npx vp check --no-fmt <paths>` |
| 3 | Lint | `npm run lint` | Focused: `npx vp lint <paths>`. Needs `packages/freecut-editor/dist` — run `npm run build:editor-surface` first on a fresh tree, else a pre-existing TS2307 on the self-referencing `@quantfive/freecut-editor-surface` import (present at base too) |
| 4 | Unit tests | `npm run test:run` | Selective: `npx vp test run <file>` |
| 5 | Build | `npm run build` | |
| 6 | Feature boundaries | `npm run check:boundaries` | |
| 7 | Deps contract boundaries | `npm run check:deps-contracts` | |
| 8 | Legacy lib imports | `npm run check:legacy-lib-imports` | |
| 9 | Deps wrapper health | `npm run check:deps-wrapper-health` | |
| 10 | Unused exports | `npm run check:unused-exports` | Allowlists are ratchet baselines — never bulk-fix |
| 11 | Unused class members | `npm run check:unused-class-members` | Same ratchet rule |
| 12 | Changed-health | `npm run check:changed-health` | |
| 13 | Edge budgets | `npm run check:edge-budgets` | |
| 14 | Provenance/reproducibility | `npm run verify:provenance` | Verifies baseline manifest, license/notices, dependency + asset inventory SHA256s. `npm run package:reproducible` additionally rebuilds and writes a deterministic tarball (never publish from QA) |
| 15 | Editor-surface package build | `npm run build:editor-surface` | |
| 16 | Installed consumer smoke | `npm run test:editor-surface:consumer` | Packs `@quantfive/freecut-editor-surface` into a tarball, installs it into a fresh temp consumer project, and runs the consumer test — no publish |
| 17 | Headless contract tests (Node) | `npm run headless:test:node` | |
| 18 | Browser QA | `npm run qa:browser -- --skip-build` | Discovers a browser session (system Chrome, then Playwright chromium), renders a frame, writes screenshot/log artifacts + manifest to `artifacts/qa/`. Exit 3 = BLOCKED (no browser) — see below |
| 19 | Full headless browser suite | `npm run headless:test:chrome` | Render/edit/frame/layout contract checks in a real browser |
| 20 | Redaction | `npm run check:qa-redaction` | QA docs + artifacts must carry no secrets, tokens, absolute local paths, or embedded media bytes |

`npm run verify` aggregates gates 2 and 4–13 (type check, unit tests, build,
and all boundary/deps/fallow/edge gates) plus the portable headless suite
(`headless:test:portable` = gates 17 + 19 plus the media harness tests). Lint
(gate 3) and the remaining gates run on demand.

## Browser QA and the BLOCKED rule

Gates 18–19 need a real browser. Discovery order: system Chrome
(`channel: 'chrome'`), then the Playwright-bundled chromium. If neither
exists, `qa:browser` exits **3** and prints a BLOCKED notice — that is a hard
environment blocker, not a failure of the code, but it also means **no
browser evidence exists**. A QA report must record the gate as `⚠️ BLOCKED`
with the exact reason; it must never claim browser evidence that was not
produced, and a missing browser session never waives the gate — it blocks
readiness until re-run in an environment that has one. GPU tuning goes
through `FREECUT_CHROME_ARGS` / `FREECUT_CHROME_ARGS_REPLACE` (see
`headless/lib/cli.mjs`).

## Baseline failures are disclosed, never hidden

If a gate fails on `staging` before your change (an inherited baseline
failure — e.g. full-suite jsdom/localStorage failures), record it as FAIL in
the report with the note `inherited from base <sha>` and reproduce it at the
base SHA. Never edit allowlists, skip lists, or config to make an inherited
failure disappear.

## Draft-to-ready discipline

1. Open the PR as **DRAFT** at the exact head you verified.
2. Run the full gate set at that head from a clean tree.
3. Post the canonical QA report (format: [canonical-report.md](./canonical-report.md))
   as a PR comment, including the revision-binding block from `qa:binding`.
4. Any new commit re-arms every gate: re-run and re-post.
5. Only a **trusted judge** PASS transitions the PR out of draft. Verdicts
   are binary and fail closed. The verifier's strongest self-verdict is
   `PASS — PENDING JUDGE`; only the judge may say `READY TO MERGE`.

## Privacy

QA artifacts and reports contain no secrets, tokens, cookies, raw absolute
local paths (use repo-relative paths), or embedded media bytes. Screenshots
and logs live in gitignored `artifacts/qa/` and are referenced by
repo-relative path or uploaded to a durable URL before being cited.
`npm run check:qa-redaction` enforces this over `docs/qa` and `artifacts/qa`.
