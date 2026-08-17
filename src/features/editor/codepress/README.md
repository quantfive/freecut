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

The commit boundary is explicit: edit-engine failures return `rejected` before
the adapter commits its document and idempotency result. Once that internal
commit succeeds, the adapter returns `applied`; editor publication,
subscribers, and telemetry are best-effort observers whose synchronous or
asynchronous failures cannot change the committed result.

`request_job` remains part of the canonical command vocabulary, but the pure
engine rejects it as `unsupported_command` until a host explicitly owns the
`MediaJobClient` dispatch. It never reports a media job as applied while doing
nothing.

## Caption UI

`CaptionEditor` is the FreeCut-side controlled caption surface consumed by an
editor shell. It reads a frame-native `FreeCutFrameDocument`, but every mutation
is translated back into the canonical integer-microsecond command contract before
it reaches `CodePressCommandAdapter`. Track display toggles use the canonical
track mute field; cue text/timing, track defaults, cue-specific styles, and
track/cue removal all carry the adapter's revision and precondition checks.

The UI rejects empty, out-of-range, overlapping, duplicate, and over-budget cue
sets before submitting them. A rejected revision or idempotency result is shown
as an accessible error and is never automatically rebased.

The existing `headless/` browser harness and its localhost `/v1` service are
not imported here and remain development-only implementation seams.

## Timing rule

The public contract is integer microseconds. FreeCut positions are integer
frames, so all mutation timestamps are required to equal the deterministic
canonical integer-microsecond representation of a frame at the document FPS.
`timing.ts` uses rational `BigInt` arithmetic for alignment and nearest-frame
conversion; it does not depend on a browser clock or floating-point remainder.
The controlled document bridge converts each interval endpoint independently,
so valid fractional-rate intervals (including 30000/1001) preserve their frame
indices even when the integer-microsecond duration is not itself a canonical
frame timestamp.

## Ripple and captions

`ripple_delete` operates on `[start_us, end_us)` in the selected tracks (or all
tracks for `track_ids: null`). Downstream items shift left by the exact frame
delta, with each shifted endpoint re-encoded from its resulting frame index.
An item crossing both boundaries is split deterministically: the
left-hand fragment keeps the original ID and the right-hand fragment receives a
stable `:ripple-right` ID. Fragment suffix allocation reserves its bounded
suffix space, so maximum-length source IDs still receive deterministic unique
fragments. Caption cues use the same interval semantics and remain ordinary
caption-track items in the controlled document.

Frame translation constructs frame-native objects explicitly; legacy
microsecond endpoint and property fields are not retained alongside their
frame equivalents.
