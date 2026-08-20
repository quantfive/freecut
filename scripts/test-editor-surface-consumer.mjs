import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ROOT = path.join(ROOT, 'packages/freecut-editor')
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const artifactName = `freecut-editor-surface-${packageJson.version}.tgz`
const defaultArtifact = path.join(ROOT, 'artifacts', artifactName)
const fixtureFiles = [
  'consumer-smoke.test.tsx',
  'consumer-smoke.setup.ts',
  'consumer-smoke-style.d.ts',
  'vite.editor-package.test.config.ts',
]

function fail(message) {
  throw new Error(`[editor-surface-consumer] ${message}`)
}

function assertCondition(condition, message) {
  if (!condition) fail(message)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    stdio: 'inherit',
  })
  assertCondition(result.status === 0, `${command} ${args.join(' ')} failed`)
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function vpPath(fixture) {
  return path.join(
    fixture,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vp.cmd' : 'vp',
  )
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  assertCondition(value && !value.startsWith('--'), `${name} requires a value`)
  return value
}

function dependencySpec(name) {
  const version = rootPackageJson.devDependencies?.[name] ?? rootPackageJson.dependencies?.[name]
  assertCondition(version, `missing pinned fixture dependency: ${name}`)
  return `${name}@${version}`
}

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-editor-consumer-'))
  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    `${JSON.stringify(
      {
        name: 'freecut-editor-consumer-smoke-fixture',
        private: true,
        type: 'module',
        version: '0.0.0',
      },
      null,
      2,
    )}\n`,
  )
  for (const file of fixtureFiles) {
    const source = file === 'vite.editor-package.test.config.ts' ? path.join(ROOT, file) : path.join(PACKAGE_ROOT, file)
    const target = file === 'vite.editor-package.test.config.ts' ? 'vite.config.ts' : file
    fs.copyFileSync(source, path.join(fixture, target))
  }
  return fixture
}

function fixtureDependencies() {
  return [
    '@testing-library/dom',
    '@testing-library/jest-dom',
    '@testing-library/react',
    '@vitejs/plugin-react',
    'jsdom',
    'react',
    'react-dom',
    'vite-plus',
  ].map(dependencySpec)
}

function verifyInstalledPackage(fixture) {
  const installedPackage = path.join(
    fixture,
    'node_modules',
    '@quantfive',
    'freecut-editor-surface',
    'package.json',
  )
  assertCondition(fs.existsSync(installedPackage), 'packed package was not installed in fixture')
  const installedPackageJson = JSON.parse(fs.readFileSync(installedPackage, 'utf8'))
  assertCondition(
    installedPackageJson.name === packageJson.name,
    `installed package name mismatch: ${installedPackageJson.name}`,
  )
  assertCondition(
    installedPackageJson.version === packageJson.version,
    `installed package version mismatch: ${installedPackageJson.version}`,
  )
}

function resolveArtifact() {
  const requested = readArg('--artifact')
  if (requested) {
    const artifact = path.resolve(ROOT, requested)
    assertCondition(fs.existsSync(artifact), `artifact does not exist: ${artifact}`)
    return artifact
  }

  run(npmCommand(), ['run', 'package:editor-surface'], ROOT)
  assertCondition(fs.existsSync(defaultArtifact), `package command did not create ${defaultArtifact}`)
  return defaultArtifact
}

// fallow-ignore-next-line complexity
function main() {
  const artifact = resolveArtifact()
  const fixture = createFixture()
  try {
    run(
      npmCommand(),
      [
        'install',
        '--ignore-scripts',
        '--no-package-lock',
        '--no-save',
        artifact,
        ...fixtureDependencies(),
      ],
      fixture,
    )
    verifyInstalledPackage(fixture)
    run(vpPath(fixture), ['test', 'run', '--config', path.join(fixture, 'vite.config.ts')], fixture)
    console.log(`[editor-surface-consumer] installed and tested ${packageJson.name}@${packageJson.version}`)
    console.log(`[editor-surface-consumer] fixture ${fixture}`)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
