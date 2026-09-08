# Word editing — #7144 PR4

This source change is stacked on FreeCut PR38 (`ux7144-03-reliability`,
6c11e173656b7b00b2c418784959dbc4e0a71803). Its consumer companion is stacked on
CodePress PR7147 (a69438dc447c913f47f1af28aeb05ca54630f58f). The parent owns
package adoption, the 0.3.12 vendor patch, asset guards, and aggregate QA.
No package version was changed or published for this work.

Provider words remain immutable source data. The host contract adds measured
`words`, `timingSource`, per-range `itemId`, and the `occurrenceSelection` opt-in.
The source mapper rejects synthetic, malformed, or partial word coverage. It
projects each occurrence through source trims and speed into unrounded sequence
frames; the backend quantizes once to the nearest rational project-frame
boundary (half up) and rejects zero-frame cuts. Only proven linked same-source,
same-time representations are deduplicated. Sparse word selections do not merge
across unselected words.

The host view seeks/selects words, extends by drag/Shift or keyboard, cuts
immediately through preview + one controller submission, and derives remaining
words from authoritative occurrences. Selection binds to document revision and
transcript/source identity. Older hosts can seek but cannot cut words. Playback
highlight is separate from selection; gaps clear it, and manual reading
suspends following until Resume following. Standalone defaults to the whole
edit and uses its existing single undoable split/ripple operation with ranges
keyed by occurrence. Linked media cut together even if clip linked-selection is
disabled. Lock and transition/frame preflight run before mutation.

Validation performed in this isolated worktree:

- Focused host UI/mapping, standalone mapping/range removal tests (including
  repeated sources, linked audio, undo/redo, disjoint source ranges, and gaps).
- Browser fixtures for host: click seek/select, Backspace cuts one repeat,
  local fixture persistence after reload, undo restoration, active-word gap,
  follow suspend/resume, Shift+arrow selection, adjacent textarea Backspace,
  section-only fallback, and old-host capability denial; no page errors.
- Browser fixture for standalone: whole-edit default, real store Backspace
  footage cut, repeated source preserved, one undo restores words/footage;
  no page errors.
- Source boundary/dependency/edge/unused-export checks, package build and
  installed-package consumer smoke tests. Changed-health passes against the
  actual PR38 base. Full source check encounters PR38's two inherited readonly
  fixture `.push` errors in controller.test.ts; parent owns their test-only fix.

Browser fixture artifacts and scripts remain in this worker's ignored
`tmp/ux7144-pr4/` directory: host-selection.png, host-legacy.png,
host-narrow.png, standalone.png, browser.mjs, standalone-browser.mjs and TSX
fixtures. These use manually specified timing fixtures, not claimed provider
transcription runs. The host persistence/undo transport is a fixture; it is not
an authenticated CodePress session or durable backend-history browser proof.
Backend companion tests separately exercise real atomic preview/apply in a
worker-owned disposable Postgres instance. No live-project transcription or
media upload request was made.

Explicit follow-ups agreed with the parent: mixed-source host transcript
batching (current source is labeled), durable text correction, and a real
regenerate/align/cache-bypass path. Existing Generate transcript can reuse a
cached transcript; Start over does not supply missing words. Audio listening,
authenticated aggregate CodePress playback/reload, and the unprompted user
usability session remain integration evidence gaps. Caption design/export is
PR5's scope.
