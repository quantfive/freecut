# Edit reliability implementation evidence

Tracks quantfive/codepress#7144. Source base: `b8995a0f3f4eca7658597b44b488ffe80929a46e`
(`codepress-main`), which already includes 0.3.13 focused-clip shortcuts and optional host history.
CodePress still pins patched 0.3.12. This source PR does not publish a package or change that pin.

## Identified defects and coverage

- Runtime snapshot installation reset playhead and horizontal scroll and retained removed selected IDs. It now preserves view state, clamps the playhead only at the new endpoint, and filters selection against authoritative items.
- Controller validation advanced a speculative adapter revision; an unknown transport result could be retried as a fresh delete. Validation is isolated, a pending request blocks different intent, and **Retry save** resends its immutable batch/key. A delete of B never retries an unknown delete of A.
- Late receipts replaced newer pushed revisions. Receipt adoption now checks timeline identity and revision, and observer failures cannot strand submission cleanup.
- A push during trim could overwrite the gesture. Optional `beginTrim` / `commitTrim` / `cancelTrim` capture the authoritative snapshot and original selection, consume a token once, and defer store installation until settlement. Changed authority rejects without rebasing. No-op, cancellation, duplicate commit, and pending admission are covered.
- Explicit trim intent produces existing `trim_item` and bounded `move_item` commands for normal/ripple/roll. Source frame deltas round once using speed; attachment breaks are retained. Exhausted handles fail local validation. Linked trims and synchronized cross-track ripple trims remain unsupported and reject before any mutation.

PR2 owns pointer-hook wiring for the optional trim port. This PR exposes the port and tests it directly; the combined pointer gesture and visibility cancellation need aggregate verification. It does not infer an operation from a compound render diff on that explicit path. Other existing store actions retain their current supported-diff path.

## Executed checks

- Host unit suite: 106 passing tests across seven files, including 10 new regression cases and the adjusted explicit-retry case.
- Core controller/runtime/context/trim/status type-aware check: passed.
- Feature boundaries, dependency contracts, edge budgets, unused exports and class members: passed.
- Provenance verification: passed.
- Chrome browser host fixture: seven passing tests. Real mounted FreeCut surface with a deterministic host fixture, **not an authenticated CodePress backend**. Includes focused Delete/Backspace linked-cohort deletion, Meta/Control undo/redo, context menu deletion, exact-key Retry, and host textarea Space/Backspace ownership followed by timeline focus.
- Browser screenshots: `artifacts/host-delete-ripple-retry.png`, `artifacts/host-delete-ripple-menu.png`, `artifacts/host-history-meta-undone.png`, `artifacts/host-history-control-after.png`. Videos: `artifacts/pr3-browser-results/`.

## Remaining integration evidence

The scoped check including `editor-surface.tsx` reports unresolved `@/index.css` side-effect declarations; core changed logic passes. Full build/package/installed consumer verification and complete repository gate suite remain for aggregate delivery. No authenticated backend, real media playback/source-frame inspection, inspector/search focus matrix, or combined PR2 pointer trim is claimed here. Parent owns release version/pin/vendor patch reconciliation and aggregate package verification. The original tester usability pass remains outstanding.
