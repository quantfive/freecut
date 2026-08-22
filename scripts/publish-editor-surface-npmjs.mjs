import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ROOT = path.join(ROOT, 'packages/freecut-editor')
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const NPMJS_REGISTRY = 'https://registry.npmjs.org'
const RELEASE_REF = 'origin/codepress-main'
const artifactName = `freecut-editor-surface-${packageJson.version}.tgz`
const artifactPath = path.join(ROOT, 'artifacts', artifactName)
const dryRun = process.argv.includes('--dry-run')

function fail(message) {
  throw new Error(`[editor-surface-npmjs] ${message}`)
}

function assertCondition(condition, message) {
  if (!condition) fail(message)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    stdio: 'inherit',
  })
  assertCondition(result.status === 0, `${command} ${args.join(' ')} failed`)
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function resolveCommit(cwd, ref) {
  try {
    return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`])
  } catch {
    fail(`--ref does not resolve to a commit: ${ref}`)
  }
}

/**
 * Release guards: the public npmjs artifact must be packaged from the exact
 * merged release revision, never from uncommitted or unrelated source.  Runs
 * before any preflight/build step, in dry-run mode too.
 * Exported for scripts/publish-editor-surface-npmjs.test.mjs.
 */
export function assertReleaseRevision(cwd, refArg) {
  assertCondition(
    typeof refArg === 'string' && refArg.length > 0,
    'release requires an explicit --ref <merged-release-sha> (or --ref HEAD)',
  )
  assertCondition(
    git(cwd, ['status', '--porcelain']) === '',
    'working tree must be clean; refusing to package uncommitted source',
  )
  const head = git(cwd, ['rev-parse', 'HEAD'])
  const release = refArg === 'HEAD' ? head : resolveCommit(cwd, refArg)
  assertCondition(
    head === release,
    `HEAD (${head}) does not match --ref ${release}; check out the release commit first`,
  )
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', release, RELEASE_REF], { cwd })
  } catch {
    fail(`--ref ${release} is not an ancestor of ${RELEASE_REF}; publish only the merged release revision`)
  }
  return release
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  assertCondition(value && !value.startsWith('--'), `${name} requires a value`)
  return value
}

// Manual public-npmjs release path (fallback for the CI workflow, which
// publishes from `codepress-main` via npm trusted publishing / OIDC).
// publishConfig in the manifest is the canonical npmjs target (enforced by
// scripts/package-editor-surface.mjs); this script adds the release
// preflight and publishes the exact smoke-tested tarball with the
// maintainer's local npm auth.
function assertPublicNpmjsTarget() {
  assertCondition(
    packageJson.name === '@quantfive/freecut-editor-surface',
    'unexpected package name',
  )
  assertCondition(
    packageJson.publishConfig?.registry === NPMJS_REGISTRY &&
      packageJson.publishConfig?.access === 'public',
    'publishConfig must target the public npmjs registry',
  )
}

function main() {
  assertPublicNpmjsTarget()
  const release = assertReleaseRevision(ROOT, readArg('--ref'))
  console.log(
    `[editor-surface-npmjs] release revision ${release} verified (clean tree, HEAD match, ${RELEASE_REF} ancestor)`,
  )
  // Preflight: provenance inventories, deterministic pack, and a fresh
  // consumer install+smoke of the exact tarball (the consumer script runs
  // package:editor-surface itself).
  run(npmCommand(), ['run', 'verify:provenance'])
  run(npmCommand(), ['run', 'test:editor-surface:consumer'])
  assertCondition(fs.existsSync(artifactPath), `artifact does not exist: ${artifactPath}`)

  const args = ['publish', artifactPath]
  if (dryRun) args.push('--dry-run')
  run(npmCommand(), args)
  console.log(
    `[editor-surface-npmjs] ${dryRun ? 'dry-run validated' : 'published'} ${packageJson.name}@${packageJson.version} -> ${NPMJS_REGISTRY}`,
  )
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
