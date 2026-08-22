import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertReleaseRevision } from './publish-editor-surface-npmjs.mjs'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commitFile(cwd, name, content) {
  fs.writeFileSync(path.join(cwd, name), content)
  git(cwd, ['add', name])
  git(cwd, ['commit', '-q', '-m', name])
  return git(cwd, ['rev-parse', 'HEAD'])
}

// Two-commit fixture: A <- B, with origin/codepress-main pointing at B.
function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-surface-npmjs-guards-'))
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  const shaA = commitFile(dir, 'a.txt', 'a')
  const shaB = commitFile(dir, 'b.txt', 'b')
  git(dir, ['update-ref', 'refs/remotes/origin/codepress-main', shaB])
  return { dir, shaA, shaB }
}

test('accepts a clean tree whose HEAD matches --ref on origin/codepress-main', () => {
  const { dir, shaB } = initRepo()
  assert.equal(assertReleaseRevision(dir, shaB), shaB)
})

test('accepts --ref HEAD for a clean release-tip checkout', () => {
  const { dir, shaB } = initRepo()
  assert.equal(assertReleaseRevision(dir, 'HEAD'), shaB)
})

test('rejects a dirty worktree even when HEAD matches --ref', () => {
  const { dir, shaB } = initRepo()
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uncommitted')
  assert.throws(() => assertReleaseRevision(dir, shaB), /working tree must be clean/)
})

test('rejects when HEAD does not match --ref', () => {
  const { dir, shaA } = initRepo()
  assert.throws(() => assertReleaseRevision(dir, shaA), /does not match --ref/)
})

test('rejects a ref that is not an ancestor of origin/codepress-main', () => {
  const { dir } = initRepo()
  git(dir, ['checkout', '-q', '--orphan', 'unrelated'])
  git(dir, ['rm', '-q', '-rf', '.'])
  const orphan = commitFile(dir, 'orphan.txt', 'orphan')
  assert.throws(() => assertReleaseRevision(dir, orphan), /not an ancestor of origin\/codepress-main/)
})

test('rejects a missing --ref argument', () => {
  const { dir } = initRepo()
  assert.throws(() => assertReleaseRevision(dir, null), /requires an explicit --ref/)
})

test('rejects an unresolvable --ref', () => {
  const { dir } = initRepo()
  assert.throws(() => assertReleaseRevision(dir, 'deadbeef'.repeat(5)), /does not resolve/)
})
