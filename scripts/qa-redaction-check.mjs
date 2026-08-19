// QA privacy/redaction gate. Scans QA docs and artifacts for content that must
// never appear in committed files, PR bodies, or QA reports: secrets/tokens,
// raw absolute local paths, and embedded media bytes (data URIs).
//
// Usage: node scripts/qa-redaction-check.mjs [path ...]
//   Defaults: docs/qa and artifacts/qa (missing paths are skipped with a note).
//   Exits 1 on any finding, 0 when clean.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.log', '.json', '.mjs', '.ts', '.tsx', '.html'])
const ALLOWED_BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webm'])

const PATTERNS = [
  { name: 'GitHub token', regex: /\b(ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b|github_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer credential', regex: /\bBearer [A-Za-z0-9._-]{20,}\b/ },
  { name: 'absolute macOS user path', regex: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: 'absolute Linux home path', regex: /\/home\/[A-Za-z0-9._-]+\// },
  { name: 'absolute Windows user path', regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/ },
  { name: 'embedded media data URI', regex: /data:(image|video|audio)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/ },
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

function scanTextFile(file, relative) {
  const text = fs.readFileSync(file, 'utf8')
  const findings = []
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(text)
    if (match) {
      const line = text.slice(0, match.index).split('\n').length
      findings.push(`${relative}:${line}: ${name}`)
    }
  }
  return findings
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
