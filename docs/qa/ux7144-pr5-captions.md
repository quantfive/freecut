# Captions Library follow-up

Tracking: quantfive/codepress#7144. This is a dependent draft; its prerequisite
branch includes PR38, PR39, PR40 and PR4's word-occurrence contract checkpoints.
The source release target remains `codepress-main`; no package is published here.

## Behavior and limits

Library → More → Captions opens the existing host caption editor alongside a
non-mutating generation preview. This edit / Selected clip explicitly maps
measured transcript words into remaining clip occurrences. Missing/incomplete
word timing, mixed source scopes, old hosts, oversized ranges and locked target
tracks fail with explanations. This UI cannot align a cached legacy transcript.
Standalone points to its existing Transcript, clip context menu Generate Captions,
and temporary Clip settings workflow; it does not add a new local generator.

Apply submits one revision-bound caption-only batch. An unchecked, explicit
Replace all cues choice is required before replacing the Transcript captions
track, including its manual corrections. Other tracks are not touched. New
tracks go above video. Existing generated tracks below video require explicit
removal and recreation; the tool explains that removal loses manual corrections.
Text corrections in the caption editor never cut footage.

Track defaults reach the real preview/render projection, cue overrides take
precedence (including zero opacity), and unchanged effective styles round-trip
back to their original provenance. Explicit overrides equal to a default remain
overrides after changing that default. A subsequent clip trim still derives and
applies as a trim-only command.

## Reproducible fixture verification

- `npm run dev -- --port 4195 --strictPort`
- `node_modules/.bin/playwright test --config playwright.caption-refresh.config.ts`
- `npm run test:run -- src/features/editor/host/caption-generation.test.ts src/features/editor/host/caption-render-contract.test.ts src/features/editor/codepress/caption-editor.test.tsx src/features/editor/host/caption-editor-context.test.tsx`

The browser test generates a three-second test-pattern video with sine audio.
Its source transcript is a controlled test fixture, not provider output from real
footage. The first occurrence retains source 0–1s and 2–3s; the repeat retains
0–3s. Expected caption output is HELLO 0–1s, WORLD 1–2s, HELLO UM WORLD 2–5s.
The fixture adapter submits real surface command batches and renders the host's
native projection through `window.freecut.renderTimeline`. It is not an
authenticated CodePress backend test or a pinned consumer adoption test.

Artifacts retained under `artifacts/qa/captions/`:

- `caption-export.webm`: actual five-second rendered AV export.
- `export-hello.png`: output 0.5s / source 0.5s, HELLO.
- `export-world.png`: output 1.5s / source 2.5s, WORLD in yellow.
- `export-repeat.png`: output 3.5s / source 1.5s, HELLO UM WORLD in yellow.
- `library-1280.png`, `library-1440.png`: Library controls with independent chat.

Browser scenarios cover discovery, preview without mutation, one apply, explicit
replacement without duplicate cues, selected occurrence + one undo, live style
preview, navigation retention, and unsupported/pending/missing/error recovery.
No unprompted human usability session, authenticated provider/backend flow, or
final CodePress pin/patch/static-asset adoption is claimed. Parent owns those
integration gates.

## Backend augmentation contract evidence

Read-only inspection of CodePress `apps/backend/apps/video_editor/api.py`
`apply_video_operation` and `services.py` `apply_command_batch` establishes that
normal editor submission accepts `VideoCommandBatchRequest`, validates the
submitted batch, binds the current revision, and hashes the submitted operation
for idempotency. No transcript preview receipt ID or signed exact-preview binding
is part of this apply request. Replacement augmentation is checked again by the
surface command validator before submission. This is source evidence, not a
backend execution claim; the parent handoff records the inspected checkpoint.

Full exact-head gate results are posted separately on the draft PR.
