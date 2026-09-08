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

Hosts can also provide the optional `EditorHost.shortcuts` port. Its versioned
`HostShortcutSettings` payload carries the same override map used by FreeCut's
shortcut editor, including J/K/L transport. UI changes call `setSettings`, and
host or agent changes can flow back through `subscribe`, so embedded shortcut
configuration never becomes a UI-only setting.

As of 0.3.13, Delete/Backspace and cut shortcuts work when the timeline clip
itself has keyboard focus. Editable fields, nested controls, ordinary buttons,
and clips inside dialogs retain shortcut protection. C cuts the hovered clip at
the pointer frame; with the pointer away, it cuts exactly one selected clip at
the playhead. No selection, multiple selections, and a playhead at either clip
endpoint produce no fallback cut.

Host-backed undo/redo in 0.3.13 is opt-in through `EditorHost.history`:

```ts
history: {
  undo: () => restoreSavedHistory('undo'),
  redo: () => restoreSavedHistory('redo'),
}
```

Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z invoke those callbacks. The host owns history,
request serialization, conflict handling and persistence, and publishes the
resulting authoritative snapshot through its existing `subscribe` port. The
surface never rolls back its local temporal store in host mode. Without the
history port, host-mode undo/redo stays disabled; standalone history continues
to use the local store. Input fields, nested controls and dialogs keep their
native keyboard behavior.

CodePress requires its durable-history implementation (quantfive/codepress#6428)
and the companion history-port wiring in addition to the 0.3.13 package update;
a package upgrade alone cannot enable saved undo in a host without history.

This release incorporates the source equivalents of the focused-clip and
selected-playhead shortcut hunks in CodePress's 0.3.12 vendor patch
(quantfive/codepress#7001). Once CodePress pins this published version, remove
those two shortcut hunks while preserving unrelated vendor fixes, regenerate
the patch hash, and verify the installed package through the real host.

As of 0.3.12, host-mode timeline clips use durable forward attachment chains by
default. A detached clip is an explicit ripple break and can be reattached from
its context menu. The host-mode Delete action and Delete/Backspace shortcuts submit
one authoritative ripple-delete request for the selected linked cohort. The
controlled timeline remains unchanged until the host receipt arrives; rejected
requests surface actionable host feedback. Lift / leave gap remains the named
gap-preserving local action. An authoritative snapshot may retain a timeline item ID and media
binding while changing its source range. The mounted program monitor adopts the
new source mapping in place and keeps video and audio timing aligned; hosts do
not need to remount the surface to clear preview state.

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
npm install @quantfive/freecut-editor-surface@0.3.13
```

## Three-column shell (pending next package release)

`FREECUT_EDITOR_SHELL_VERSION = 1` identifies the optional `shell` prop. Hosts
resolve the marker from the same module as the component. `headerActions` places
the host history/export group in the project toolbar; `navigationActions` keeps
the host Chat visibility control outside hidden columns; `transcriptActions`
mounts generation/consent controls in Library without unmounting polling across
tab switches. `onLayoutChange` reports the visible Library/Editor minimum width
so the host can bound its own Chat separator. Existing callers need no props.

The shell dispatches `freecut:cancel-timeline-gesture` on its own DOM root with
`bubbles: true` before pausing playback and hiding Editor. The timeline consumer
must accept only events whose target contains its own clip element and cancel
through its existing preview cleanup path; see the companion timeline PR for
that listener. Hiding a column never remounts its contents or commits a preview.

Tracking: https://github.com/quantfive/codepress/issues/7144. Package publication
and CodePress's pinned vendor-patch/static-asset reconciliation are separate
integration steps. This source PR does not publish or bump a package version.
