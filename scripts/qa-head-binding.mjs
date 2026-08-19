// QA head-binding gate. Emits (and with --check, validates) the exact
// base/head revision-binding block that every canonical QA report must carry.
//
// A QA report is only valid for one exact head SHA on top of one exact base
// SHA, produced from a clean working tree. Any new commit re-arms the gate:
// the binding must be re-emitted and every gate re-run at the new head.
//
// Usage:
//   node scripts/qa-head-binding.mjs [--base <sha|ref>]   print the block
//   node scripts/qa-head-binding.mjs --check [--base <sha|ref>]
//        exit 1 if the tree is dirty, HEAD is not a descendant of base,
//        or base cannot be resolved
//
// Output contains only SHAs and repo-relative state — never local paths.
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASE_REF = 'origin/staging'

function fail(message) {
  console.error(`[qa-head-binding] ${message}`)
  process.exit(1)
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    if (allowFailure) return null
    fail(`git ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`)
  }
  return result.stdout.trim()
}

function readFlag(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

function resolveSha(ref, label) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true })
  if (!sha) fail(`could not resolve ${label} ref: ${ref}`)
  return sha
}

function emitBindingBlock({ base, baseRef, head, porcelain, clean }) {
  console.log('### Verifier revision binding')
  console.log(`base: ${base} (${baseRef})`)
  console.log(`head: ${head}`)
  console.log(`git rev-parse HEAD -> ${head}`)
  console.log(`git status --porcelain -> ${clean ? '(empty)' : '\n' + porcelain}`)
}

function validateBinding({ check, clean, descendant, base, head }) {
  if (!check) return
  if (!clean) fail('working tree is dirty — QA evidence must come from a clean tree')
  if (!descendant) fail(`head ${head} is not a descendant of base ${base}`)
  console.log('[qa-head-binding] OK: clean tree, head descends from base')
}

function resolveBase(baseRef) {
  if (/^[0-9a-f]{40}$/.test(baseRef)) return baseRef
  return resolveSha(baseRef, 'base')
}

function main() {
  const check = process.argv.includes('--check')
  const baseRef = readFlag('--base') ?? DEFAULT_BASE_REF
  const base = resolveBase(baseRef)
  const head = git(['rev-parse', 'HEAD'])
  const porcelain = git(['status', '--porcelain'])
  const clean = porcelain.length === 0
  const descendant =
    spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd: ROOT }).status === 0

  emitBindingBlock({ base, baseRef, head, porcelain, clean })
  validateBinding({ check, clean, descendant, base, head })
}

main()
