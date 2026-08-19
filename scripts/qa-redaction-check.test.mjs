// Fail-closed proof for the QA redaction gate (scripts/qa-redaction-check.mjs).
// Each negative fixture must make the gate exit non-zero; the clean fixture set
// must exit zero. Wired into the gate itself via `npm run check:qa-redaction`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECKER = path.join(ROOT, 'scripts', 'qa-redaction-check.mjs')
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures', 'qa-redaction')

function runChecker(target) {
  return spawnSync(process.execPath, [CHECKER, target], { cwd: ROOT, encoding: 'utf8' })
}

const NEGATIVE_FIXTURES = [
  'negative-tmp-path.txt',
  'negative-generic-path.txt',
  'negative-short-data-uri.txt',
  'negative-windows-path.txt',
]

for (const name of NEGATIVE_FIXTURES) {
  test(`redaction gate FAILS (fail-closed) on ${name}`, () => {
    const result = runChecker(path.join(FIXTURES, name))
    assert.notEqual(result.status, 0, `expected non-zero exit, got 0: ${result.stdout}`)
    assert.match(result.stderr, /\[qa-redaction\] FAIL/)
  })
}

test('redaction gate PASSES on the clean fixture set (incl. allow-marker line)', () => {
  const result = runChecker(path.join(FIXTURES, 'clean'))
  assert.equal(result.status, 0, `expected zero exit: ${result.stderr}`)
})
