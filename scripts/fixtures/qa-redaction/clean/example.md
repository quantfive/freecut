# Clean fixture

QA artifacts are referenced by repo-relative path only:
`artifacts/qa/browser-<short-sha>/manifest.json` and `docs/qa/README.md`.

URLs are not local paths: https://example.com/qa/artifacts/manifest.json is fine.
Single-segment URL paths like /headless.html are fine too.

Intentional examples can be allowlisted per line. The next line demonstrates a
path example that a doc may legitimately show:
Run the checker against /tmp/example-output/ to see a finding. qa-redaction:allow
