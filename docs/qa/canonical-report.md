# Canonical QA Report

Posted as a PR comment once the full gate set has run at the exact head.
Verdicts per gate: `✅ PASS`, `❌ FAIL`, `⚠️ BLOCKED` (BLOCKED is reserved for
hard environment blockers — missing browser session, missing credentials,
outage; anything else is FAIL).

Template:

```
## Canonical QA Report

### Verifier revision binding
base: <40-hex> (origin/codepress-main)
head: <40-hex>
git rev-parse HEAD -> <40-hex>
git status --porcelain -> (empty)

### Gate results
| # | Gate | Result | Evidence |
|---|------|--------|----------|
| 1 | Head binding | ✅ PASS | clean tree, head descends from base |
| ... | ... | ... | one line each: command + key output |

### Inherited baseline failures
- <gate>: FAIL at base <sha> with <one-line reason> — reproduced at base, not caused by this PR

### Environment blockers
- <gate>: BLOCKED — <exact reason and what re-run requires>

### Visual / browser artifacts
- artifacts/qa/browser-<short-sha>/manifest.json (+ frame.png, harness.png, console.log)

### Overall
✅ PASS — PENDING JUDGE   (or: ❌ FAIL — NOT READY TO MERGE)

No merge until trusted judge PASS.
```

Rules:

- The revision-binding block comes verbatim from `npm run qa:binding -- --check`.
  A dirty tree forces FAIL/BLOCKED; there are no exemptions.
- Evidence lines are bounded (one line per gate) and redacted — no tokens,
  no absolute local paths, no media bytes (`npm run check:qa-redaction`).
- The verifier never writes `READY TO MERGE`. The strongest self-verdict is
  `PASS — PENDING JUDGE`. The judge's verdict is binary and fails closed:
  `READY TO MERGE` (PASS) or `NOT READY TO MERGE` (FAIL).
- The report is valid only for the exact head in the binding block. Any new
  commit re-arms the gate set; the report must be regenerated and re-posted.
- Inherited baseline failures are disclosed in their own section and
  reproduced at the base SHA — never hidden by allowlist or config edits.
