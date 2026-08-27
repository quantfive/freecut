# FreeCut v1 final integration manifest

## PR #30 QA-blocker reconciliation

- Superseded QA head: `925ebf37b01692c4b066407a9ee6a8563fd8028f`
- Integration base: `origin/codepress-main` at `aedf4d70b86615a73fcb382a2843eb14606d1eb4`
- Destination: `v1-release-integration-final`
- Package: `@quantfive/freecut-editor-surface@0.3.9` (version unchanged)
- Source integration head before this evidence/provenance commit: `5709e474515443fefd994507099b9cd2afc65749`

### Commit inventory

The four fixes were cherry-picked with `-x`, in this order, from the exact superseded QA head:

| Order | Source commit | Integrated commit | Purpose |
| --- | --- | --- | --- |
| 1 | `f22464674582b2afe987cbb3486ddc60fd7d53ea` | `573c72f2b5ca1b7bd6020f59a3000980ed18f13f` | Contiguous shared-edge rolling trim |
| 2 | `c9494a515e27074482bf7ba8bbd1998f4fc8ced3` | `676d6f5cde3577457d996ca5e25edfe06ad99923` | Keyboard-accessible clips and scrollbars |
| 3 | `bec5c41eea03db70b08ec4506e2a6a72c458e37b` | `df9c0f63e82a7874333efa10a93495b6f3a41bee` | Responsive mobile editor |
| 4 | `e0bd5e66011fdb7646c8be2b8939a172dd68bc30` | `5709e474515443fefd994507099b9cd2afc65749` | Runtime observability |

All four source commits have parent `925ebf37b01692c4b066407a9ee6a8563fd8028f`.

### Conflict and overlap resolution

- `TimelineItem` had one textual import conflict. The resolution retains one named, focusable semantic clip root and keeps the shared rolling-trim sliders, trim/fade controls, and indicators as sibling interaction surfaces. This avoids nested native controls and keeps pointer gestures, Razor, playback shortcuts, lock rejection, and keyboard slider steps under their intended owners.
- The responsive commit applied without textual conflicts. Focused React and real-Chrome rows verified compact standalone and embedded-host layouts while retaining keyboard scrollbars, rolling handles, Razor routing, lock invariants, linked drag, live shortcut labels, and the desktop geometry branch.
- The observability commit auto-merged its `audio-meter-panel.tsx` overlap with the responsive layout. The result retains the compact/mobile panel contract and uses the shared media URL for waveform loading; no page-owned object URL is revoked. Export capability fallback remains preflight-only, while genuine render and worker-runtime failures remain primary errors.

### Package and provenance

- Two independent deterministic package builds produced byte-identical tarballs.
- New artifact: `artifacts/freecut-editor-surface-0.3.9.tgz`
- New SHA-256: `27855709f334dcac4eda5adc7771c9b0a1fd0b5f47e9a3844c391218ac9ba77c`
- The prior `59012...` QA artifact is superseded by this source-derived artifact.
- A fresh consumer installed the exact tarball and rendered `@quantfive/freecut-editor-surface@0.3.9`: 1 test file, 2 tests passed.
- The responsive Playwright script changed root `package.json`; the supported package-manifest hash in `provenance/freecut-baseline.json` and `provenance/dependency-inventory.json` was refreshed to `7786ffe5cde5b09b6f88fc4fd13af399365ac0d6dc32f320d6f719c6f62edc89`. Lockfile, dependency inventory, asset inventory, release workflow, and package version are unchanged.

### Verification results

All commands ran under Node `22.20.0` and npm `11.8.0` unless the command itself launched a browser.

| Gate | Result |
| --- | --- |
| Four-worker focused Vitest union | PASS — 17 files, 184 tests |
| Responsive real-Chrome standalone 390 / host 390 / desktop 1440 rows | PASS — 3/3 |
| Real Chromium QA smoke | PASS — system Chrome 151; ready, frame result, width, and PNG pixel checks |
| LOCK49 focused matrix | PASS — 12 files, 156 tests |
| DRAG45 focused matrix | PASS — 7 files, 90 tests |
| Shortcut and host-settings matrix | PASS — 15 files, 182 tests |
| Export-focused matrix | PASS — 41 files, 399 tests |
| Full serial Vitest (`maxWorkers=1`, file parallelism disabled) | PASS — 710 files, 5,288 tests; fixed thresholds unchanged |
| `npm run check` | PASS — 2,482 files, no warnings, lint errors, or type errors |
| Scoped format and diff checks | PASS — 46 formatted files; `git diff --check` clean |
| Production build | PASS |
| Boundaries / deps contracts / legacy imports / wrapper health | PASS — 1,707 source files; 161 deps and 298 contract files; 46 wrappers, 0 unused |
| Changed health / edge budgets | PASS — no introduced dead code, complexity, or duplication; all 8 seams within budgets |
| Runtime hotkey import boundary | PASS — 1,735 source files |
| Unused-export and class-member audits | Existing baseline findings only; every reported path is unchanged from the superseded QA head and both allowlists are unchanged |
| Provenance verification | PASS — source, licenses/notices, 51 runtime and 16 development dependencies, and 5 asset roots |
| Publish/release guards | PASS — 7/7 guard tests; package remains `0.3.9`; package manifest, lockfile, and publish workflow guards unchanged |
| Portable headless contracts | PASS — 43 Node contracts, real-Chrome render/edit/lifecycle, 19 edit operations, and 192,044-byte media/audio contract |
| QA redaction | PASS — 7 files scanned and 6/6 fail-closed self-tests |
| Full pre-push hook | PASS — all 7 steps |

### Hosted evidence for superseded head

Before integration, live PR #30 was OPEN and DRAFT at the exact superseded head. Its hosted `Quality Checks`, `Verify and package baseline`, and `Preview Sync Stress` checks were all `SUCCESS`. This is evidence for the old head only; no PR body, state, comment, or readiness change was made.
