---
name: pr-screenshot
description: Capture FreeCut frontend PR preview screenshots and full-motion videos using its existing Playwright setup.
user_invocable: true
codepress_generated: true
---

# FreeCut PR previews

Use for visible changes in `src/features/**/*.tsx`, `src/components/**/*.tsx`, `src/routes/**/*.tsx`, `src/**/*.css`, and `packages/freecut-editor/src/**`. Skip documentation, infrastructure and test-only changes without visual effects. This is PR-preview evidence; it does not prove ship-gate frontend behavior or hosted readiness. During Factory init capture locally only: no commits, pushes, PR edits or asset publication.

## Map changes to captures

| Changed surface | Page/state |
| --- | --- |
| Workspace gate, branding | `/projects` before workspace selection |
| Projects | `/projects`, `/projects/new` with disposable OPFS workspace |
| Editor, timeline, media, preview, effects, export, settings | `/editor/<id>` reached by creating a disposable project; open the changed panel |
| Published host surface | `/tests/browser/host-responsive.html` existing preview fixture |
| Docs, changelog | `/docs`, `/changelog` |

Read `git diff origin/codepress-main...HEAD --name-only` and map every affected visible area. Static layout needs screenshots; interactions/animation/dragging need full-motion WebM, optionally a screenshot too. Capture meaningful final state and nearby context, not a loading shell. For responsive changes add 390x844 to desktop 1440x1100. Use locator visibility and bounding boxes before capturing; avoid excessively long full-page images.

## Runtime and fixtures

This root owns npm/package-lock.json and Playwright (`playwright/test`, not a new @playwright/test install). Node 22+ is recommended. Run `npm ci --no-audit --no-fund` when dependencies need setup. Existing `playwright.mobile.config.ts` uses system Chrome, a single worker and real Vite at 127.0.0.1:4178 with `npm run dev -- --port 4178 --strictPort`. Other configs cover caption/layout refresh. Reuse their infrastructure and selectors, preserve all customer config. If Chrome is absent, use the installed Playwright chromium runtime; install with `npm exec -- playwright install chromium` from this root if needed and authorized. No application backend or login exists; no credentials or auth bypass is needed.

For capture-only specs, create an owned temporary `tests/browser/_codepress-pr-preview.spec.ts` and a temporary config importing the mobile config, overriding `testMatch` to that filename, `testDir` to this checkout's tests/browser, outputDir to an owned /tmp directory, `reuseExistingServer: false`, and viewport to 1440x1100. Keep `channel: chrome` if available, otherwise override channel to undefined for installed Chromium. Require the port to be free; never kill a user's server. Run `npm exec -- playwright test --config <owned-config-path> --workers=1`. Vite must return HTTP 200 within its bounded config timeout. Preserve COOP/COEP headers. In a hosted runner use only the connected CodePress MicroVM lifecycle; never start customer servers on its control plane or claim local capture provisioned a VM.

## Capture spec

Adapt the real OPFS fixture from `tests/browser/responsive-editor.spec.ts`:

```typescript
import { test, expect } from 'playwright/test'

test('editor preview', async ({ page }) => {
  await page.goto('/projects', { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const modulePath = '/src/infrastructure/storage/handles-db.ts'
    const handles = await import(/* @vite-ignore */ modulePath)
    await handles.saveWorkspaceHandleRecord(root)
  })
  await page.reload()
  await page.getByRole('link', { name: 'New Project' }).click()
  await page.getByRole('textbox', { name: /Project Name/ }).fill('PR Preview')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.waitForURL(/\/editor\//)
  await expect(page.locator('[role="application"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add track', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/pr-screenshots/editor.png', fullPage: false })
})
```

Create `/tmp/pr-screenshots` before running. Use a fresh browser context so OPFS contains synthetic projects only. For changed media workflows reuse repository-generated fixtures rather than customer files. Preview fixtures are labeled as such; do not substitute them for real behavior QA. Collect page errors, console errors and failed requests and explain failures. Open the screenshot and confirm relevant UI is legible and the file exceeds 10KB; file existence alone is insufficient.

For video add `test.use({ video: { mode: 'on', size: { width: 1440, height: 1100 } } })`; perform the actual changed interaction, assert its final state and keep it visible briefly. Close the page/context to finalize the recording and copy `await page.video().path()` to the owned capture directory. Preserve the full original WebM. Trim loading pre-roll in a separate copy if useful; never convert to GIF.

For a later authorized visual PR, before/after is the default: render the same spec at the merge-base with `origin/codepress-main` in a separate temporary worktree, with separately installed dependencies, isolated output and only required safe synthetic fixtures. Harvest each run before the next; do not overwrite fresh output with stale baseline captures. Missing base state or incompatible fixtures yields an explained after-only preview. Stamp the Demo section with the captured SHA. Init is after-only bootstrap and does not create worktrees or delivery commits.

## Attach only during authorized delivery

Inspect every image/video for credentials, personal/customer content and confidential data before publication. Recapture with synthetic data when needed. Local Terminal delivery requires GitHub CLI v2.99.0+ and `gh pr edit --help` showing `--attach`. Preserve the current PR body via `gh pr view --json body --jq .body` into an owned body file; reference images by exact local path and videos as a standalone `![](path)` paragraph. Attach every file using repeatable `--attach` flags with `gh pr edit --body-file <body-file>` (or authorized create), preserving full video. A nonzero exit can mean partial publication: re-read the live body, retry only unresolved attachments once, or remove unresolved local references and update the cleaned body. Re-read to prove no local references survive. If cleanup cannot be done, report the PR URL and exact blocker. No GIF or Release-upload fallback.

In CodePress cloud delivery use `upload_pr_asset` for each image and full WebM because GitHub App tokens cannot use the CLI attachment uploader; embed returned HTTPS image URLs and plain full-video links. If unavailable, report publication BLOCKED. Factory delivery owners follow `codepress factory skill` for guarded PR operations; this skill does not authorize delivery or bypass those gates.

Always close owned browser contexts and servers in finally, terminate/reap owned child process groups, and prove their listeners are gone. Remove only temporary specs/configs created by this run. Retain captures until review/publication is complete; never remove customer files. For init hash this skill and safe Codex mirror before smoke and confirm unchanged afterward, recording local image path, dimensions, observations and cleanup in the stage report.
