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
import os from 'node:os'
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

async function launchBrowser() {
  const attempts = [
    { label: 'system Chrome (channel: chrome)', options: { channel: 'chrome' } },
    { label: 'Playwright bundled chromium', options: {} },
  ]
  const errors = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        ...attempt.options,
        headless: true,
        args: chromeLaunchArgs(),
      })
      console.log(`[qa-browser] browser session: ${attempt.label} (${browser.version()})`)
      return { browser, label: attempt.label }
    } catch (error) {
      errors.push(`${attempt.label}: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
  blocked(`browser discovery found no available browser session — ${errors.join(' | ')}`)
}

async function main() {
  if (process.argv.includes('--skip-build')) {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'headless.html'))) {
      throw new Error('dist/headless.html missing — run npm run build first or drop --skip-build')
    }
  } else {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
  }

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const outDir = path.join(ROOT, 'artifacts', 'qa', `browser-${head.slice(0, 12)}`)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const { browser, label } = await launchBrowser()
  const server = await createHarnessServer({ distDir: path.join(ROOT, 'dist'), resolveMedia: () => null })
  const consoleLines = []
  let failures = 0
  const check = (name, condition, detail) => {
    if (condition) console.log(`  PASS  ${name}`)
    else {
      failures++
      console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
    }
  }

  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('console', (message) => consoleLines.push(`[console:${message.type()}] ${message.text()}`))
    page.on('pageerror', (error) => {
      failures++
      consoleLines.push(`[pageerror] ${error.message}`)
      console.error('  FAIL  page error —', error.message)
    })

    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    check('harness reports ready', true)

    const frameDownloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    frameDownloadPromise.catch(() => {})
    const frameSummary = await page.evaluate((input) => window.freecut.renderFrame(input), {
      project: FRAME_PROJECT,
      atSeconds: 0.5,
    })
    const framePath = path.join(outDir, 'frame.png')
    const frameDownload = await frameDownloadPromise
    await frameDownload.saveAs(framePath)
    check('renderFrame returns ok', frameSummary.ok === true)
    check('frame matches project width', frameSummary.width === 640, `got ${frameSummary.width}`)
    check(
      'frame PNG has real pixels (>1KB)',
      fs.existsSync(framePath) && fs.statSync(framePath).size > 1000,
      `${fs.existsSync(framePath) ? fs.statSync(framePath).size : 0} bytes`,
    )

    await page.screenshot({ path: path.join(outDir, 'harness.png') })

    // Defensive redaction: never let absolute local paths reach the log artifact.
    const logText = consoleLines.join('\n').split(ROOT).join('<repo>').split(os.homedir()).join('<home>')
    fs.writeFileSync(path.join(outDir, 'console.log'), `${logText}\n`)

    const artifacts = ['frame.png', 'harness.png', 'console.log']
    const manifest = {
      schema: 'freecut-qa-browser/v1',
      head,
      browser: { label, version: browser.version() },
      generatedAt: new Date().toISOString(),
      artifacts: Object.fromEntries(
        artifacts.map((name) => [
          name,
          { bytes: fs.statSync(path.join(outDir, name)).size, sha256: sha256File(path.join(outDir, name)) },
        ]),
      ),
      result: failures === 0 ? 'PASS' : 'FAIL',
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`[qa-browser] artifacts: artifacts/qa/browser-${head.slice(0, 12)}/ (${artifacts.join(', ')}, manifest.json)`)
  } finally {
    await browser.close()
    await server.close()
  }

  if (failures > 0) {
    console.error(`[qa-browser] ${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('[qa-browser] PASS')
}

main().catch((error) => {
  console.error(`[qa-browser] crashed: ${error?.message ?? error}`)
  process.exit(1)
})
