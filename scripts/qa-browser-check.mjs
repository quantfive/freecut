// Browser QA gate. Discovers a usable browser session, exercises the headless
// render harness in it, and writes screenshot/log artifacts plus a manifest to
// artifacts/qa/browser-<short-head-sha>/ (gitignored).
//
// Exit codes:
//   0  PASS — artifacts written
//   1  FAIL — a check failed
//   3  BLOCKED — no browser session available in this environment
//
// BLOCKED is reserved for hard environment blockers (no browser binary). A
// BLOCKED result never counts as browser evidence; the QA report must say so.
//
// Run: node scripts/qa-browser-check.mjs [--skip-build]
import { chromium } from 'playwright'
import { execFileSync, execSync } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { createHarnessServer } from '../headless/server.mjs'
import { chromeLaunchArgs } from '../headless/lib/cli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FRAME_PROJECT = {
  id: 'qa-browser-project',
  name: 'QA Browser',
  description: '',
  createdAt: 1735689600000,
  updatedAt: 1735689600000,
  duration: 30,
  schemaVersion: 10,
  metadata: { width: 640, height: 360, fps: 30, backgroundColor: '#101418' },
  timeline: {
    masterBusDb: 0,
    tracks: [
      {
        id: 'track-1',
        name: 'V1',
        kind: 'video',
        height: 60,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ],
    items: [
      {
        id: 'text-1',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: 'Title',
        type: 'text',
        text: 'qa-browser',
        color: '#ffffff',
        fontSize: 64,
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'middle',
        transform: {},
      },
    ],
    transitions: [],
    keyframes: [],
    compositions: [],
  },
}

function blocked(message) {
  console.error(`[qa-browser] BLOCKED: ${message}`)
  console.error('[qa-browser] no browser evidence was produced; the QA report must record this gate as BLOCKED')
  process.exit(3)
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function describeLaunchError(label, error) {
  return `${label}: ${String(error?.message ?? error).split('\n')[0]}`
}

async function tryLaunch({ label, options }) {
  const browser = await chromium.launch({
    ...options,
    headless: true,
    args: chromeLaunchArgs(),
  })
  console.log(`[qa-browser] browser session: ${label} (${browser.version()})`)
  return { browser, label }
}

async function launchBrowser() {
  const attempts = [
    { label: 'system Chrome (channel: chrome)', options: { channel: 'chrome' } },
    { label: 'Playwright bundled chromium', options: {} },
  ]
  const errors = []
  for (const attempt of attempts) {
    const launched = await tryLaunch(attempt).catch((error) => {
      errors.push(describeLaunchError(attempt.label, error))
      return null
    })
    if (launched) return launched
  }
  blocked(`browser discovery found no available browser session — ${errors.join(' | ')}`)
}

async function ensureBuild() {
  if (!process.argv.includes('--skip-build')) {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
    return
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'headless.html'))) {
    throw new Error('dist/headless.html missing — run npm run build first or drop --skip-build')
  }
}

function prepareOutDir(head) {
  const outDir = path.join(ROOT, 'artifacts', 'qa', `browser-${head.slice(0, 12)}`)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  return outDir
}

function report(failures, name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`)
    return
  }
  failures.push(name)
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

function pngSize(filePath) {
  if (!fs.existsSync(filePath)) return 0
  return fs.statSync(filePath).size
}

async function grabFrame(page, outDir, failures) {
  const frameDownloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  frameDownloadPromise.catch(() => {})
  const frameSummary = await page.evaluate((input) => window.freecut.renderFrame(input), {
    project: FRAME_PROJECT,
    atSeconds: 0.5,
  })
  const framePath = path.join(outDir, 'frame.png')
  const frameDownload = await frameDownloadPromise
  await frameDownload.saveAs(framePath)
  report(failures, 'renderFrame returns ok', frameSummary.ok === true)
  report(failures, 'frame matches project width', frameSummary.width === 640, `got ${frameSummary.width}`)
  report(
    failures,
    'frame PNG has real pixels (>1KB)',
    pngSize(framePath) > 1000,
    `${pngSize(framePath)} bytes`,
  )
}

async function runPageChecks(browser, server, outDir) {
  const failures = []
  const consoleLines = []
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  page.on('console', (message) => consoleLines.push(`[console:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => {
    failures.push('page error')
    consoleLines.push(`[pageerror] ${error.message}`)
    console.error('  FAIL  page error —', error.message)
  })

  await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
  report(failures, 'harness reports ready', true)

  await grabFrame(page, outDir, failures)
  await page.screenshot({ path: path.join(outDir, 'harness.png') })
  return { failures, consoleLines }
}

// Generic absolute local path (same contract as qa-redaction-check): any Unix
// absolute path of 2+ segments not embedded in a URL, or any Windows drive
// path. Sanitization must not depend on knowing the specific roots in advance.
const ABSOLUTE_PATH =
  /(?<![\w:/+.~>-])(?:[A-Za-z]:\\[^\s'"<>|]+|\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]*)/g

function sanitizeLogText(text) {
  return text.replace(ABSOLUTE_PATH, '<path>')
}

function writeConsoleLog(outDir, consoleLines) {
  // Defensive redaction: no absolute local path may reach the log artifact,
  // regardless of which root it lives under.
  const logText = sanitizeLogText(consoleLines.join('\n'))
  fs.writeFileSync(path.join(outDir, 'console.log'), `${logText}\n`)
}

function writeManifest(outDir, { head, label, version, failures }) {
  const artifacts = ['frame.png', 'harness.png', 'console.log']
  const manifest = {
    schema: 'freecut-qa-browser/v1',
    head,
    browser: { label, version },
    generatedAt: new Date().toISOString(),
    artifacts: Object.fromEntries(
      artifacts.map((name) => [
        name,
        { bytes: fs.statSync(path.join(outDir, name)).size, sha256: sha256File(path.join(outDir, name)) },
      ]),
    ),
    result: failures.length === 0 ? 'PASS' : 'FAIL',
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `[qa-browser] artifacts: artifacts/qa/browser-${head.slice(0, 12)}/ (${artifacts.join(', ')}, manifest.json)`,
  )
}

function reportOutcome(failures) {
  if (failures.length > 0) {
    console.error(`[qa-browser] ${failures.length} check(s) FAILED`)
    process.exit(1)
  }
  console.log('[qa-browser] PASS')
}

async function main() {
  await ensureBuild()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const outDir = prepareOutDir(head)

  const { browser, label } = await launchBrowser()
  const server = await createHarnessServer({ distDir: path.join(ROOT, 'dist'), resolveMedia: () => null })
  try {
    const { failures, consoleLines } = await runPageChecks(browser, server, outDir)
    writeConsoleLog(outDir, consoleLines)
    writeManifest(outDir, { head, label, version: browser.version(), failures })
    reportOutcome(failures)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((error) => {
  console.error(`[qa-browser] crashed: ${error?.message ?? error}`)
  process.exit(1)
})
