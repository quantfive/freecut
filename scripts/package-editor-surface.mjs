import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ROOT = path.join(ROOT, 'packages/freecut-editor')
const DIST = path.join(PACKAGE_ROOT, 'dist')
const ARTIFACTS = path.join(ROOT, 'artifacts')
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const artifactName = `freecut-editor-surface-${packageJson.version}.tgz`
const artifactPath = path.join(ARTIFACTS, artifactName)

function fail(message) {
  throw new Error(`[editor-surface-package] ${message}`)
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function packageFiles() {
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, entry)
      const relative = path.relative(PACKAGE_ROOT, absolute).split(path.sep).join('/')
      const stat = fs.lstatSync(absolute)
      assertCondition(!stat.isSymbolicLink(), `symbolic link is not allowed: ${relative}`)
      if (stat.isDirectory()) visit(absolute)
      else if (stat.isFile()) files.push(relative)
      else fail(`unsupported package input: ${relative}`)
    }
  }
  visit(PACKAGE_ROOT)
  return files
}

function verifyBuildBoundary() {
  for (const required of ['index.js', 'index.d.ts', 'style.css']) {
    assertCondition(fs.existsSync(path.join(DIST, required)), `missing package output: dist/${required}`)
  }

  const forbiddenImportPatterns = [
    /(?:^|["'])@\/features\/workspace-gate\//,
    /(?:^|["'])@\/headless\//,
    /(?:^|["'])\.\/src\/headless\//,
    /(?:^|["'])@\/app\.tsx?/,
    /(?:^|["'])@\/infrastructure\/storage\/workspace-fs\/bootstrap/,
    /(?:^|["'])@tanstack\/react-router["']/,
  ]
  for (const file of packageFiles().filter(
    (candidate) => candidate.startsWith('dist/') && candidate.endsWith('.js'),
  )) {
    const javascript = fs.readFileSync(path.join(PACKAGE_ROOT, file), 'utf8')
    for (const pattern of forbiddenImportPatterns) {
      assertCondition(
        !pattern.test(javascript),
        `forbidden consumer dependency in ${file}: ${pattern}`,
      )
    }
    assertCondition(!javascript.includes('@/'), `source alias leaked into ${file}`)
    assertCondition(!javascript.includes('../../../src/'), `raw source-relative alias leaked into ${file}`)
    assertCondition(!javascript.includes('/Users/'), `local filesystem path leaked into ${file}`)
    assertCondition(!javascript.includes('file://'), `file URL leaked into ${file}`)
  }
}

function verifyPackageInputs() {
  assertCondition(packageJson.name === '@quantfive/freecut-editor-surface', 'unexpected package name')
  assertCondition(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version), 'package version must be semver')
  assertCondition(packageJson.exports?.['./style.css'] === './dist/style.css', 'style export must be stable')
  assertCondition(packageJson.peerDependencies?.react, 'React must remain a peer dependency')
  assertCondition(packageJson.peerDependencies?.['react-dom'], 'React DOM must remain a peer dependency')
  assertCondition(fs.existsSync(path.join(PACKAGE_ROOT, 'README.md')), 'package README is missing')
  assertCondition(fs.existsSync(path.join(PACKAGE_ROOT, 'LICENSE')), 'package LICENSE is missing')
}

// fallow-ignore-next-line complexity
function archiveEntries(directory, archivePrefix) {
  const entries = [{ type: 'directory', name: `${archivePrefix}/`, sourcePath: directory }]
  for (const entry of fs.readdirSync(directory).sort()) {
    if (entry === '.gitkeep') continue
    const sourcePath = path.join(directory, entry)
    const archiveName = `${archivePrefix}/${entry}`
    const stat = fs.lstatSync(sourcePath)
    assertCondition(!stat.isSymbolicLink(), `symbolic link is not allowed: ${archiveName}`)
    if (stat.isDirectory()) entries.push(...archiveEntries(sourcePath, archiveName))
    else if (stat.isFile()) entries.push({ type: 'file', name: archiveName, sourcePath })
    else fail(`unsupported package input: ${archiveName}`)
  }
  return entries
}

function tarString(header, offset, length, value) {
  const bytes = Buffer.from(value)
  assertCondition(bytes.length <= length, `tar header field is too long: ${value}`)
  bytes.copy(header, offset)
}

function tarOctal(header, offset, length, value) {
  tarString(header, offset, length, `${Math.floor(value).toString(8).padStart(length - 1, '0')}\0`)
}

function tarHeader(entry) {
  const header = Buffer.alloc(512)
  tarString(header, 0, 100, entry.name)
  tarOctal(header, 100, 8, entry.type === 'directory' ? 0o755 : 0o644)
  tarOctal(header, 108, 8, 0)
  tarOctal(header, 116, 8, 0)
  tarOctal(header, 124, 12, entry.type === 'file' ? fs.statSync(entry.sourcePath).size : 0)
  tarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = entry.type === 'directory' ? 0x35 : 0x30
  tarString(header, 257, 6, 'ustar\0')
  tarString(header, 263, 2, '00')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  tarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return
  await once(stream, 'drain')
}

async function pack() {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
  fs.rmSync(artifactPath, { force: true })
  const staticEntries = ['LICENSE', 'README.md', 'package.json'].map((file) => ({
    type: 'file',
    name: `package/${file}`,
    sourcePath: path.join(PACKAGE_ROOT, file),
  }))
  const entries = [
    { type: 'directory', name: 'package/', sourcePath: PACKAGE_ROOT },
    ...staticEntries,
    ...archiveEntries(DIST, 'package/dist'),
  ].sort((left, right) => left.name.localeCompare(right.name))

  const gzip = createGzip({ level: 9, mtime: 0 })
  const output = fs.createWriteStream(artifactPath)
  gzip.pipe(output)
  for (const entry of entries) {
    await writeChunk(gzip, tarHeader(entry))
    if (entry.type !== 'file') continue
    const bytes = fs.readFileSync(entry.sourcePath)
    await writeChunk(gzip, bytes)
    const remainder = bytes.length % 512
    if (remainder !== 0) await writeChunk(gzip, Buffer.alloc(512 - remainder))
  }
  await writeChunk(gzip, Buffer.alloc(1024))
  gzip.end()
  await once(output, 'close')
  return artifactPath
}

function verifyTarball(filePath) {
  const listing = execFileSync('tar', ['-tzf', filePath], { encoding: 'utf8' })
  const entries = listing.split('\n').filter(Boolean)
  assertCondition(entries.includes('package/dist/index.js'), 'tarball is missing dist/index.js')
  assertCondition(entries.includes('package/dist/index.d.ts'), 'tarball is missing dist/index.d.ts')
  assertCondition(entries.includes('package/dist/style.css'), 'tarball is missing dist/style.css')
  assertCondition(entries.includes('package/package.json'), 'tarball is missing package.json')
  assertCondition(!entries.some((entry) => entry.includes('node_modules/')), 'tarball contains node_modules')
  assertCondition(!entries.some((entry) => entry.includes('/src/')), 'tarball contains source files')
}

async function main() {
  verifyPackageInputs()
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:editor-surface'])
  verifyBuildBoundary()
  const artifact = await pack()
  verifyTarball(artifact)
  console.log(`[editor-surface-package] artifact ${path.relative(ROOT, artifact)}`)
  console.log(`[editor-surface-package] version ${packageJson.version}`)
  console.log(`[editor-surface-package] sha256 ${sha256(artifact)}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
