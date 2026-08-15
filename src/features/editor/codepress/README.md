# Controlled CodePress/FreeCut boundary

This directory is the FreeCut-side PR3 adapter boundary. Its public surface is
the versioned, integer-microsecond command/document contract and explicit
controlled ports:

- `ControlledEditorPort` owns an in-memory document while mounted;
- `ControlledEditEngine` applies a bounded command list atomically and is safe
  to run in a worker;
- `document.ts` is the only frame-native translation seam; it maps typed
  FreeCut frame documents to/from the controlled microsecond document;
- `ControlledRenderer` receives a frame-aligned request and returns a
  renderer-owned payload;
- host interfaces (`ProjectStore`, `AssetResolver`, job, presence, upload, and
  telemetry ports) keep CodePress persistence and media resolution outside
  FreeCut.

`CodePressCommandAdapter` validates a PR1-shaped batch, checks the current
revision and preconditions, applies it through the pure edit engine, records
idempotent replays, and publishes the accepted controlled document. A failed
command never replaces the document.

The existing `headless/` browser harness and its localhost `/v1` service are
not imported here and remain development-only implementation seams.

## Timing rule

The public contract is integer microseconds. FreeCut positions are integer
frames, so all mutation timestamps are required to equal the deterministic
canonical integer-microsecond representation of a frame at the document FPS.
`timing.ts` uses rational `BigInt` arithmetic for alignment and nearest-frame
conversion; it does not depend on a browser clock or floating-point remainder.

## Ripple and captions

`ripple_delete` operates on `[start_us, end_us)` in the selected tracks (or all
tracks for `track_ids: null`). Downstream items shift left by the exact frame
delta. An item crossing both boundaries is split deterministically: the
left-hand fragment keeps the original ID and the right-hand fragment receives a
stable `:ripple-right` ID. Caption cues use the same interval semantics and
remain ordinary caption-track items in the controlled document.
