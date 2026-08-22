# `@quantfive/freecut-editor-surface`

This package is the versioned browser entry for FreeCut's host-backed editor
surface. It exports the real `FreeCutEditorSurface`, the `EditorHostProvider`,
and the typed host contract used to supply authoritative project state, media
resolution, and bounded edit submission.

The package owns the editor UI and in-memory browser runtime only. The host
owns authentication, persistence, transport, media bytes, and short-lived
media resolution. It does not include the standalone FreeCut app, router
provider, workspace bootstrap, headless services, or local project storage
bootstrap.

## Usage

```tsx
import { FreeCutEditorSurface, type EditorHost } from '@quantfive/freecut-editor-surface'
import '@quantfive/freecut-editor-surface/style.css'

export function HostEditor({ host }: { host: EditorHost }) {
  return <FreeCutEditorSurface host={host} />
}
```

The `EditorHost` contract carries opaque media locators and authoritative
snapshots. It never accepts filesystem paths, permanent URLs, provider keys,
or media bytes. Supported edits are submitted through `submitEdit`; rejected
or conflicting results return an authoritative snapshot to the surface. The
0.3.0 surface adds an optional host-backed transcript consumer. Hosts opt into the
transcript tab by providing `EditorHost.transcript` and explicitly enabling
`media.transcription`. The port returns a compact status receipt and bounded
microsecond sections, and previews source-bound caption commands with
`willMutateTimeline: false`; only an explicit user action submits that returned
batch through `submitEdit`. Transcript IDs, asset IDs, source hashes, cursors,
and structured errors are opaque browser data—authentication, transport,
provider details, URLs, paths, and media bytes remain host-owned.

The same 0.3.0 surface retains the host-backed caption tracks, bounded cues,
caption styles, and display toggles from 0.2.0.

This package is built from a specific FreeCut commit. To create the local
consumer artifact from a clean checkout, run:

```bash
npm ci --ignore-scripts
npm run package:editor-surface
```

The command writes a deterministic tarball to `artifacts/`. The canonical
release target is the **public npmjs registry**: `publishConfig` in this
manifest points at `https://registry.npmjs.org` with `"access": "public"`
(enforced by `scripts/package-editor-surface.mjs`). GitHub Packages is no
longer a release target for this package.

**CI (tag or manual dispatch).** The workflow in
`.github/workflows/publish-editor-surface.yml` verifies provenance, builds
the deterministic tarball, smoke-tests it as an installed consumer, and
publishes to npmjs with `NODE_AUTH_TOKEN` from the `NPM_TOKEN` repo secret
(npm automation token with publish rights on the `@quantfive` scope). A repo
admin must add that secret before tag publishes work; until then, use the
manual path below.

**Manual (maintainer).** Run from a clean checkout of the merged staging
commit with local npm auth, naming that commit explicitly:

```bash
npm ci --ignore-scripts
npm run publish:editor-surface:npmjs -- --ref <merged-staging-sha>
```

`scripts/publish-editor-surface-npmjs.mjs` refuses to package anything else:
before the preflight it requires a clean worktree (`git status --porcelain`
empty), HEAD equal to `--ref`, and `--ref` an ancestor of `origin/staging`
— so the public artifact is always reproducible from the merged staging
revision, never from uncommitted or unrelated source. The guards run in
`--dry-run` too. After the guards it runs the preflight (provenance
verification, deterministic pack, and a fresh-consumer install + smoke of
the exact tarball) and then publishes
`artifacts/freecut-editor-surface-<version>.tgz` to npmjs. Run
`npm run publish:editor-surface:npmjs -- --ref <sha> --dry-run` to validate
without publishing; guard behavior is covered by
`npm run test:publish-editor-surface-guards`. Versions 0.3.1 and 0.3.2 are
released this way.

Do not commit a token.

Consumers install the exact published version and keep it pinned in their
lockfile:

```bash
npm install @quantfive/freecut-editor-surface@0.3.0
```
