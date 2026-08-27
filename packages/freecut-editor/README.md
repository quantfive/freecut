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

Hosts can also provide the optional `EditorHost.shortcuts` port. Its versioned
`HostShortcutSettings` payload carries the same override map used by FreeCut's
shortcut editor, including J/K/L transport. UI changes call `setSettings`, and
host or agent changes can flow back through `subscribe`, so embedded shortcut
configuration never becomes a UI-only setting.

This package is built from a specific FreeCut commit. To create the local
consumer artifact from a clean checkout, run:

```bash
npm ci --ignore-scripts
npm run package:editor-surface
```

The command writes a deterministic tarball to `artifacts/`. The package is
published to the `quantfive` GitHub Packages npm registry by the
manual/tagged workflow in `.github/workflows/publish-editor-surface.yml`.
The first GitHub Packages publication defaults to private; verify that
visibility remains private and grant `quantfive/codepress` read access under
**Manage Actions access** before CodePress installs it.

For an authorized local publication, authenticate with a GitHub classic PAT
that has `write:packages` and run:

```bash
NODE_AUTH_TOKEN="$GITHUB_CLASSIC_PAT" npm publish \
  artifacts/freecut-editor-surface-0.3.0.tgz \
  --registry=https://npm.pkg.github.com
```

Do not commit a token. The workflow uses its `GITHUB_TOKEN` with
`packages: write`; CodePress CI uses its `GITHUB_TOKEN` with `packages: read`
after the repository has been granted package access.

CodePress should route the `@quantfive` scope to GitHub Packages and provide
`NODE_AUTH_TOKEN` in CI:

```ini
@quantfive:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

It can then install the exact published version and keep it pinned in its
lockfile:

```bash
npm install @quantfive/freecut-editor-surface@0.3.0
```
