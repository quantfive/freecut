// QA privacy/redaction gate. Scans QA docs and artifacts for content that must
// never appear in committed files, PR bodies, or QA reports: secrets/tokens,
// raw absolute local paths (any Unix root or Windows drive path, matched
// generically — not a list of known roots), and embedded media bytes (any
// image/video/audio data URI, regardless of payload length).
//
// A line carrying the marker `qa-redaction:allow` is exempt from the
// path/data-URI patterns only, for intentional documentation examples.
//
// Usage: node scripts/qa-redaction-check.mjs [path ...]
//   Defaults: docs/qa and artifacts/qa (missing paths are skipped with a note).
//   Exits 1 on any finding, 0 when clean.
//   Fail-closed proof: scripts/qa-redaction-check.test.mjs (negative fixtures).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.log', '.json', '.mjs', '.ts', '.tsx', '.html'])
const ALLOWED_BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webm'])

// Lines carrying this marker are skipped by the path/data-URI patterns. It
// exists ONLY for intentional examples in documentation (e.g. a doc that must
// show what a violating line looks like); secrets are never allowlisted.
const ALLOW_MARKER = 'qa-redaction:allow'

// Generic absolute local path: any Unix absolute path of 2+ segments that is
// not part of a URL (lookbehind rejects matches preceded by a scheme or host
// character), or any Windows drive path with either separator. Covers /Users,
// /home, /tmp, /var, /opt, /mnt, /private, and every other root — there is no
// exhaustive list.
const ABSOLUTE_PATH =
  /(?<![\w:/+.~>-])(?:[A-Za-z]:[\\/][^\s'"<>|]*|\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]*)/

const SECRET_PATTERNS = [
  { name: 'GitHub token', regex: /\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b|github_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer credential', regex: /\bBearer [A-Za-z0-9._-]{20,}\b/ },
]

const PATH_PATTERNS = [
  { name: 'absolute local path', regex: ABSOLUTE_PATH },
  // Any embedded media data URI, regardless of payload length.
  { name: 'embedded media data URI', regex: /data:(image|video|audio)\/[A-Za-z0-9.+-]*;base64,/i },
]

function collectFiles(target, files) {
  const stat = fs.statSync(target)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) collectFiles(path.join(target, entry), files)
    return
  }
  files.push(target)
}

function collectTargetFiles(args) {
  const targets = args.length > 0 ? args : ['docs/qa', 'artifacts/qa']
  const files = []
  for (const target of targets) {
    const absolute = path.resolve(ROOT, target)
    if (!fs.existsSync(absolute)) {
      console.log(`[qa-redaction] note: ${target} does not exist, skipped`)
      continue
    }
    collectFiles(absolute, files)
  }
  return files
}

function scanBinaryArtifact(relative, extension) {
  if (ALLOWED_BINARY_EXTENSIONS.has(extension)) return []
  return [`${relative}: unexpected binary artifact type "${extension}"`]
}

function secretFindings(relative, lineNumber, line) {
  const findings = []
  for (const { name, regex } of SECRET_PATTERNS) {
    if (regex.test(line)) findings.push(`${relative}:${lineNumber}: ${name}`)
  }
  return findings
}

function pathFindings(relative, lineNumber, line) {
  if (line.includes(ALLOW_MARKER)) return []
  const findings = []
  for (const { name, regex } of PATH_PATTERNS) {
    if (regex.test(line)) findings.push(`${relative}:${lineNumber}: ${name}`)
  }
  return findings
}

function lineFindings(relative, lineNumber, line) {
  return [
    ...secretFindings(relative, lineNumber, line),
    ...pathFindings(relative, lineNumber, line),
  ]
}

function scanTextFile(file, relative) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  return lines.flatMap((line, index) => lineFindings(relative, index + 1, line))
}

function scanFile(file) {
  const relative = path.relative(ROOT, file)
  const extension = path.extname(file).toLowerCase()
  if (!TEXT_EXTENSIONS.has(extension)) return scanBinaryArtifact(relative, extension)
  return scanTextFile(file, relative)
}

function reportFindings(findings, fileCount) {
  if (findings.length > 0) {
    for (const finding of findings) console.error(`[qa-redaction] FAIL ${finding}`)
    console.error(
      `[qa-redaction] ${findings.length} finding(s) — remove secrets, local paths, and embedded media before publishing`,
    )
    process.exit(1)
  }
  console.log(`[qa-redaction] OK: ${fileCount} file(s) scanned, no findings`)
}

function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const files = collectTargetFiles(args)
  const findings = files.flatMap(scanFile)
  reportFindings(findings, files.length)
}

main()
