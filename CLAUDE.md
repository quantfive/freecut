# FreeCut Web

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export

## Git

- `codepress-main` — **the release branch of this fork**: everything merges there, and every push publishes `@quantfive/freecut-editor-surface` via npm trusted publishing (`.github/workflows/publish-editor-surface.yml`). `staging` is no longer a release target
- `main` — a clean mirror of upstream `walterlow/freecut`, kept fast-forward by `.github/workflows/sync-upstream.yml`; nothing CodePress-owned lands there
- PR target: `codepress-main`. Do **not** open PRs against `main` directly
- Conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)
