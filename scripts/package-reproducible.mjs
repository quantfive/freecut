import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(ROOT, 'provenance/freecut-baseline.json')
const DEPENDENCY_INVENTORY_PATH = path.join(ROOT, 'provenance/dependency-inventory.json')
const ASSET_INVENTORY_PATH = path.join(ROOT, 'provenance/asset-inventory.json')
const verifyOnly = process.argv.includes('--verify-only')

function fail(message) {
  throw new Error(`[reproducible-package] ${message}`)
}

function assertCondition(condition, message) {
  if (!condition) fail(message)
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`could not read JSON ${path.relative(ROOT, filePath)}: ${error.message}`)
  }
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function sha256File(relativePath) {
  const filePath = path.join(ROOT, relativePath)
  assertCondition(fs.existsSync(filePath), `missing file: ${relativePath}`)
  return sha256Bytes(fs.readFileSync(filePath))
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    )
  }
  return value
}

function equalJson(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    }).trim()
  } catch (error) {
    fail(`git ${args.join(' ')} failed: ${error.message}`)
  }
}

function gitFiles(pathSpec) {
  const output = gitOutput(['ls-files', '--', pathSpec])
  return output ? output.split('\n').filter(Boolean).sort(compareStrings) : []
}

function compareStrings(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function verifySource(manifest) {
  const source = manifest.upstream
  assertCondition(source.repository === 'https://github.com/walterlow/freecut', 'unexpected upstream repository')
  assertCondition(source.fork === 'https://github.com/quantfive/freecut', 'unexpected fork repository')
  assertCondition(/^[0-9a-f]{40}$/.test(source.revision), 'upstream revision must be a full git SHA')

  gitOutput(['cat-file', '-e', `${source.revision}^{commit}`])
  const head = gitOutput(['rev-parse', 'HEAD'])
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', source.revision, head], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  assertCondition(ancestry.status === 0, `${source.revision} is not an ancestor of HEAD ${head}`)

  const tree = gitOutput(['rev-parse', `${source.revision}^{tree}`])
  assertCondition(tree === source.tree, `source tree mismatch: expected ${source.tree}, got ${tree}`)

  const archive = spawnSync(
    'git',
    [
      'archive',
      '--format=tar',
      `--prefix=${source.archive.prefix}/`,
      source.revision,
    ],
    {
      cwd: ROOT,
      encoding: null,
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
      maxBuffer: 512 * 1024 * 1024,
    },
  )
  assertCondition(archive.status === 0, `could not archive source revision: ${archive.stderr?.toString() ?? ''}`)
  const archiveSha256 = sha256Bytes(archive.stdout)
  assertCondition(
    archiveSha256 === source.archive.sha256,
    `source archive checksum mismatch: expected ${source.archive.sha256}, got ${archiveSha256}`,
  )

  console.log(`[reproducible-package] source ${source.repository}@${source.revision} verified`)
}

function verifyNotices(manifest) {
  assertCondition(manifest.license.spdx === 'MIT', 'the retained project license must remain MIT')
  assertCondition(
    sha256File(manifest.license.path) === manifest.license.sha256,
    `license checksum mismatch: ${manifest.license.path}`,
  )
  const licenseText = fs.readFileSync(path.join(ROOT, manifest.license.path), 'utf8')
  assertCondition(licenseText.includes('MIT License'), 'LICENSE does not contain the MIT heading')
  assertCondition(
    licenseText.includes('Permission is hereby granted'),
    'LICENSE does not contain the MIT permission notice',
  )

  for (const notice of manifest.retainedNotices) {
    assertCondition(
      sha256File(notice.path) === notice.sha256,
      `retained notice checksum mismatch: ${notice.path}`,
    )
  }
  console.log('[reproducible-package] MIT license and retained notices verified')
}

function verifyDependencies(manifest) {
  const packageJson = readJson(path.join(ROOT, manifest.dependencies.packageJson))
  const lockfile = readJson(path.join(ROOT, manifest.dependencies.lockfile))
  const inventory = readJson(path.join(ROOT, manifest.dependencies.inventory))

  const packageJsonSha256 = sha256File(manifest.dependencies.packageJson)
  const lockfileSha256 = sha256File(manifest.dependencies.lockfile)
  assertCondition(
    packageJsonSha256 === manifest.dependencies.packageJsonSha256,
    `package.json checksum mismatch: expected ${manifest.dependencies.packageJsonSha256}, got ${packageJsonSha256}`,
  )
  assertCondition(
    lockfileSha256 === manifest.dependencies.lockfileSha256,
    `package-lock.json checksum mismatch: expected ${manifest.dependencies.lockfileSha256}, got ${lockfileSha256}`,
  )
  assertCondition(lockfile.lockfileVersion === manifest.dependencies.lockfileVersion, 'lockfile version mismatch')
  assertCondition(inventory.packageName === packageJson.name, 'dependency inventory package name mismatch')
  assertCondition(inventory.packageVersion === packageJson.version, 'dependency inventory package version mismatch')
  assertCondition(inventory.packageJsonSha256 === packageJsonSha256, 'dependency inventory package checksum mismatch')
  assertCondition(inventory.lockfile.sha256 === lockfileSha256, 'dependency inventory lockfile checksum mismatch')
  assertCondition(inventory.lockfile.lockfileVersion === lockfile.lockfileVersion, 'dependency inventory lockfile version mismatch')

  const directDependencies = {
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
  }
  assertCondition(
    equalJson(inventory.directDependencies, directDependencies),
    'direct dependency inventory differs from package.json',
  )

  const lockRoot = lockfile.packages?.['']
  assertCondition(lockRoot, 'package-lock.json does not contain the root package')
  assertCondition(equalJson(lockRoot.dependencies ?? {}, packageJson.dependencies ?? {}), 'lockfile dependencies differ from package.json')
  assertCondition(
    equalJson(lockRoot.devDependencies ?? {}, packageJson.devDependencies ?? {}),
    'lockfile devDependencies differ from package.json',
  )
  console.log(
    `[reproducible-package] dependency inventory verified (${Object.keys(directDependencies.dependencies).length} runtime, ${Object.keys(directDependencies.devDependencies).length} development)`,
  )
}

function trackedAssetRecords(pathSpec) {
  const files = gitFiles(pathSpec)
  const records = files.map((file) => {
    const bytes = fs.readFileSync(path.join(ROOT, file))
    return { path: file, bytes: bytes.length, sha256: sha256Bytes(bytes) }
  })
  const hashInput = records
    .sort((left, right) => compareStrings(left.path, right.path))
    .map((record) => `${record.path}\0${record.bytes}\0${record.sha256}\n`)
    .join('')
  return {
    fileCount: records.length,
    byteCount: records.reduce((total, record) => total + record.bytes, 0),
    sha256: sha256Bytes(hashInput),
  }
}

function verifyAssets(manifest) {
  const inventory = readJson(path.join(ROOT, manifest.assets.inventory))
  assertCondition(inventory.hashAlgorithm === manifest.assets.hashAlgorithm, 'asset hash algorithm mismatch')
  for (const root of inventory.roots) {
    const actual = trackedAssetRecords(root.path)
    assertCondition(actual.fileCount === root.fileCount, `asset count mismatch for ${root.path}`)
    assertCondition(actual.byteCount === root.byteCount, `asset byte count mismatch for ${root.path}`)
    assertCondition(actual.sha256 === root.sha256, `asset checksum mismatch for ${root.path}`)
  }
  console.log(`[reproducible-package] asset inventory verified (${inventory.roots.length} roots)`)
}

function verifyBaseline() {
  const manifest = readJson(MANIFEST_PATH)
  assertCondition(manifest.schema === 'freecut-pr2-provenance-baseline/v1', 'unexpected provenance schema')
  assertCondition(Number(process.versions.node.split('.')[0]) >= manifest.packaging.nodeMajor, 'Node.js 22 or newer is required')
  verifySource(manifest)
  verifyNotices(manifest)
  verifyDependencies(manifest)
  verifyAssets(manifest)
  return manifest
}

function copyTree(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath)
  if (sourceStat.isSymbolicLink()) fail(`symbolic links are not allowed in package input: ${sourcePath}`)
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true })
    for (const entry of fs.readdirSync(sourcePath).sort(compareStrings)) {
      copyTree(path.join(sourcePath, entry), path.join(targetPath, entry))
    }
    return
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
}

function addStageFile(stageRoot, sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const sourcePath = path.join(ROOT, sourceRelativePath)
  const targetPath = path.join(stageRoot, targetRelativePath)
  assertCondition(fs.existsSync(sourcePath), `package input is missing: ${sourceRelativePath}`)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
}

function collectArchiveEntries(directoryPath, archivePrefix) {
  const entries = [{ type: 'directory', name: `${archivePrefix}/`, sourcePath: directoryPath }]
  for (const entry of fs.readdirSync(directoryPath).sort(compareStrings)) {
    const sourcePath = path.join(directoryPath, entry)
    const archiveName = `${archivePrefix}/${entry}`
    const stat = fs.lstatSync(sourcePath)
    if (stat.isSymbolicLink()) fail(`symbolic links are not allowed in package input: ${sourcePath}`)
    if (stat.isDirectory()) entries.push(...collectArchiveEntries(sourcePath, archiveName))
    else if (stat.isFile()) entries.push({ type: 'file', name: archiveName, sourcePath })
    else fail(`unsupported package input: ${sourcePath}`)
  }
  return entries
}

function writeStringField(header, offset, length, value) {
  const bytes = Buffer.from(value)
  assertCondition(bytes.length <= length, `tar header field is too long: ${value}`)
  bytes.copy(header, offset)
}

function writeOctalField(header, offset, length, value) {
  const text = Math.floor(value).toString(8).padStart(length - 1, '0') + '\0'
  writeStringField(header, offset, length, text)
}

function tarHeader(entry) {
  const header = Buffer.alloc(512)
  writeStringField(header, 0, 100, entry.name)
  writeOctalField(header, 100, 8, entry.type === 'directory' ? 0o755 : 0o644)
  writeOctalField(header, 108, 8, 0)
  writeOctalField(header, 116, 8, 0)
  const size = entry.type === 'file' ? fs.statSync(entry.sourcePath).size : 0
  writeOctalField(header, 124, 12, size)
  writeOctalField(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = entry.type === 'directory' ? 0x35 : 0x30
  writeStringField(header, 257, 6, 'ustar\0')
  writeStringField(header, 263, 2, '00')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeStringField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

function createTar(entries) {
  const chunks = []
  for (const entry of entries) {
    chunks.push(tarHeader(entry))
    if (entry.type !== 'file') continue
    const bytes = fs.readFileSync(entry.sourcePath)
    chunks.push(bytes)
    const remainder = bytes.length % 512
    if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function createDeterministicGzip(tarBytes) {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0x02, 0xff])
  const compressed = deflateRawSync(tarBytes, { level: 9 })
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(crc32(tarBytes), 0)
  trailer.writeUInt32LE(tarBytes.length >>> 0, 4)
  return Buffer.concat([header, compressed, trailer])
}

function runBuild() {
  fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true })
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    stdio: 'inherit',
  })
  assertCondition(result.status === 0, 'npm run build failed')
}

function createPackage(manifest) {
  const artifactDirectory = path.join(ROOT, 'artifacts')
  const artifactPath = path.join(artifactDirectory, `freecut-${manifest.upstream.revision}.tar.gz`)
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-reproducible-'))
  const packageRoot = path.join(stage, 'freecut')

  try {
    copyTree(path.join(ROOT, 'dist'), path.join(packageRoot, 'dist'))
    addStageFile(packageRoot, 'LICENSE')
    addStageFile(packageRoot, 'README.md')
    addStageFile(packageRoot, 'package.json')
    addStageFile(packageRoot, 'package-lock.json')
    addStageFile(packageRoot, 'src/infrastructure/audio/THIRD_PARTY_LICENSE', 'notices/THIRD_PARTY_LICENSE')
    addStageFile(packageRoot, 'src/infrastructure/upscale/models/NOTICE.md', 'notices/upscale-models-NOTICE.md')
    addStageFile(packageRoot, 'provenance/freecut-baseline.json')
    addStageFile(packageRoot, 'provenance/dependency-inventory.json')
    addStageFile(packageRoot, 'provenance/asset-inventory.json')

    const entries = collectArchiveEntries(packageRoot, 'freecut')
    const gzipBytes = createDeterministicGzip(createTar(entries))
    fs.mkdirSync(artifactDirectory, { recursive: true })
    fs.writeFileSync(artifactPath, gzipBytes)
    console.log(`[reproducible-package] wrote ${path.relative(ROOT, artifactPath)} (${gzipBytes.length} bytes)`)
    console.log(`[reproducible-package] artifact sha256 ${sha256Bytes(gzipBytes)}`)
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

function main() {
  const manifest = verifyBaseline()
  if (verifyOnly) {
    console.log('[reproducible-package] verification-only run passed')
    return
  }
  runBuild()
  verifyBaseline()
  createPackage(manifest)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
