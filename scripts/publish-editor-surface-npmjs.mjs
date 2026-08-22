import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ROOT = path.join(ROOT, 'packages/freecut-editor')
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const NPMJS_REGISTRY = 'https://registry.npmjs.org'
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

// Manual public-npm release path.  The package manifest intentionally keeps
// publishConfig pointed at the private GitHub Packages registry (enforced by
// scripts/package-editor-surface.mjs); this script overrides the registry on
// the command line only, so the CI tag/dispatch path is untouched.  CodePress
// consumes the package from npmjs.
function main() {
  assertCondition(
    packageJson.name === '@quantfive/freecut-editor-surface',
    'unexpected package name',
  )
  // Preflight: provenance inventories, deterministic pack, and a fresh
  // consumer install+smoke of the exact tarball (the consumer script runs
  // package:editor-surface itself).
  run(npmCommand(), ['run', 'verify:provenance'])
  run(npmCommand(), ['run', 'test:editor-surface:consumer'])
  assertCondition(fs.existsSync(artifactPath), `artifact does not exist: ${artifactPath}`)

  const args = [
    'publish',
    artifactPath,
    `--registry=${NPMJS_REGISTRY}`,
    // The scoped package must stay publicly installable for CodePress; the
    // flag applies to this publish only and does not modify the manifest.
    '--access=public',
  ]
  if (dryRun) args.push('--dry-run')
  run(npmCommand(), args)
  console.log(
    `[editor-surface-npmjs] ${dryRun ? 'dry-run validated' : 'published'} ${packageJson.name}@${packageJson.version} -> ${NPMJS_REGISTRY}`,
  )
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
