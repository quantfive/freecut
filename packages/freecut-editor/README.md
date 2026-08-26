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

## Sizing

The surface is an embedded component, not an app: it fills the box you give it
(`height: 100%`) and never sizes itself against the viewport. Give the element
you render it into a definite height. If your app has chrome of its own — a
fixed header, a sidebar — subtract that in your own container; the surface has
no knowledge of that chrome and must not be told about it.

```tsx
<main className="h-[calc(100dvh-73px)] overflow-hidden">
  <FreeCutEditorSurface host={host} />
</main>
```

The chain of definite heights has to be unbroken: any wrapper between your sized
container and the surface (a React mount point, say) needs a height of its own,
or the percentage stops resolving and the surface falls back to sizing itself to
its content. A container with an indefinite height (`height: auto`) collapses
the surface, and a container taller than its own parent scrolls it out of view —
both are host-side layout bugs, not surface bugs.

The `EditorHost` contract carries opaque media locators and authoritative
snapshots. It never accepts filesystem paths, permanent URLs, provider keys,
or media bytes. Supported edits are submitted through `submitEdit`; rejected
or conflicting results return an authoritative snapshot to the surface. The
0.3.0 surface adds an optional host-backed transcript consumer. Hosts opt into the
transcript tab by providing `EditorHost.transcript` and explicitly enabling
`media.transcription`. The port returns a compact status receipt and bounded
microsecond sections, and previews source-bound caption commands with
`willMutateTimeline: false`; only an explicit user action submits that returned
batch through `submitEdit`. The same preview path also produces a source-bound
cut: `action: 'cut'` returns `ripple_delete` commands, which the surface accepts
under the `timeline.remove` capability. A host that can start a transcription
implements the optional `transcript.requestTranscription({ assetId, language })`;
the surface then polls `getStatus` until the receipt is terminal. Transcript IDs,
asset IDs, source hashes, cursors, and structured errors are opaque browser data—authentication, transport,
provider details, URLs, paths, and media bytes remain host-owned.

The same 0.3.0 surface retains the host-backed caption tracks, bounded cues,
caption styles, and display toggles from 0.2.0.

The 0.3.7 surface lets the host register its own modules into the editor's
left sidebar rail. `EditorHost.sidebarModules` entries (`{ id, label, icon,
Panel }`) appear as `host:<id>` rail tabs; the surface renders each module's
`Panel` in the sidebar panel area, mounts it on first activation, and keeps it
mounted across tab switches and authoritative snapshot installs so in-flight
host work survives. Each `Panel` receives `{ active, collapsed, width }`, so it
can pause work while it is not the selected tab and adapt to a sidebar resize
without measuring the DOM itself. Icons and panels cross the package boundary
as React components (react/react-dom are peer dependencies).

`FreeCutEditorSurface` also accepts an optional `apiRef` that receives a
`FreeCutEditorSurfaceApi` — `openSidebarModule(id)` selects a module's tab and
opens the panel (ids the rail does not show fail closed), and `closeSidebar()`
closes the panel.

By default the rail is the capability-gated built-ins (`media`, then `text` and
`transcript` when the host's capabilities allow them) followed by the modules in
registration order. `EditorHost.sidebarRail` replaces that with an explicit
rail: the exact tabs, in the exact order, with anything omitted hidden — which
is how a host both reorders the rail and suppresses built-ins it does not want.
Capability gating still runs first, so a rail can only ever subtract from and
reorder what the capabilities already allow, never add to it. Ids matching no
available tab are dropped, as are repeats after the first, and a rail that
matches nothing at all falls back to the default rather than leaving the editor
with no navigation.

```tsx
const apiRef = useRef<FreeCutEditorSurfaceApi>(null)

const host: EditorHost = {
  // ...capabilities, load, resolveMedia, submitEdit
  sidebarModules: [
    { id: 'transcribe', label: 'Transcribe', icon: Captions, Panel: TranscribePanel },
    { id: 'brand-kit', label: 'Brand kit', icon: Palette, Panel: BrandKitPanel },
  ],
  // Host module first, no built-in `text` tab.
  sidebarRail: ['host:transcribe', 'media', 'host:brand-kit'],
}

<FreeCutEditorSurface host={host} apiRef={apiRef} />
```

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

**CI (the release path).** `codepress-main` is the release branch. The
workflow in `.github/workflows/publish-editor-surface.yml` runs on every push
to `codepress-main` and on `freecut-editor-surface-v*` tags: it verifies
provenance, builds the deterministic tarball, smoke-tests it as an installed
consumer, and publishes to npmjs. A merge that does not bump the version is a
no-op, not a failure — the workflow skips publishing a version that already
exists.

Publishing uses npm trusted publishing (OIDC): the workflow exchanges its
GitHub Actions identity token for a short-lived npm credential and publishes
with `--provenance`. There is no `NPM_TOKEN` secret in this repository, and
none should be added. The trusted publisher is configured on npmjs.com
against this repository and `.github/workflows/publish-editor-surface.yml`;
changing that filename breaks publishing until the publisher entry is updated
to match.

**Manual (maintainer fallback).** Run from a clean checkout of the merged
release commit with local npm auth, naming that commit explicitly:

```bash
npm ci --ignore-scripts
npm run publish:editor-surface:npmjs -- --ref <merged-release-sha>
```

`scripts/publish-editor-surface-npmjs.mjs` refuses to package anything else:
before the preflight it requires a clean worktree (`git status --porcelain`
empty), HEAD equal to `--ref`, and `--ref` an ancestor of
`origin/codepress-main` — so the public artifact is always reproducible from
the merged release revision, never from uncommitted or unrelated source. The
guards run in `--dry-run` too. After the guards it runs the preflight
(provenance verification, deterministic pack, and a fresh-consumer install +
smoke of the exact tarball) and then publishes
`artifacts/freecut-editor-surface-<version>.tgz` to npmjs. Run
`npm run publish:editor-surface:npmjs -- --ref <sha> --dry-run` to validate
without publishing; guard behavior is covered by
`npm run test:publish-editor-surface-guards`.

Do not commit a token.

Consumers install the exact published version and keep it pinned in their
lockfile:

```bash
npm install @quantfive/freecut-editor-surface@0.3.0
```
