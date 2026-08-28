/// <reference types="node" />

import { expect, test, type Page } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const generatedSourceRangeMedia = resolve('tests/browser/.source-range-generated.webm')

test.beforeAll(() => {
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000:duration=2',
    '-filter_complex',
    '[0:v][1:a][2:v][3:a]concat=n=2:v=1:a=1[v][a]',
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '30',
    '-c:a',
    'libopus',
    '-b:a',
    '96k',
    generatedSourceRangeMedia,
  ])
})

test.afterAll(() => {
  try {
    unlinkSync(generatedSourceRangeMedia)
  } catch {
    // The generator may have failed before creating the temporary fixture.
  }
})

async function installOpfsWorkspace(page: Page) {
  await page.goto('/projects', { waitUntil: 'networkidle' })
  await page.waitForURL(/\/projects/)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const handlesModulePath = '/src/infrastructure/storage/handles-db.ts'
    const handles = await import(/* @vite-ignore */ handlesModulePath)
    await handles.saveWorkspaceHandleRecord(root)
  })
  await page.reload()
}

async function createProject(page: Page, name: string) {
  await installOpfsWorkspace(page)
  await page.getByRole('link', { name: 'New Project' }).click()
  await page.getByRole('textbox', { name: /Project Name/ }).fill(name)
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.waitForURL(/\/editor\//)
  await page.locator('[role="application"]').waitFor()
}

async function expectInside(locator: ReturnType<Page['locator']>, width: number, height: number) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 0.5)
}

async function openAndCloseDrawer(page: Page, name: 'Media' | 'Properties' | 'Meters') {
  const trigger = page.getByRole('button', { name, exact: true })
  await trigger.focus()
  await trigger.click()
  const drawer = page.getByRole('dialog', { name, exact: true })
  await expect(drawer).toBeVisible()
  await expect
    .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
  await expectInside(drawer, 390, 844)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
}

test('retained host item switches generated picture and audio source range without remount', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/tests/browser/source-range-host.html')
  const program = page.locator('[aria-label="Program monitor"]')
  await expect(program).toBeVisible()
  await expect(program.locator('video')).toHaveCount(1)

  const readProgramMedia = () =>
    program.locator('video').evaluate((video: HTMLVideoElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.drawImage(video, 0, 0, 1, 1)
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
      return { red, green, blue, currentTime: video.currentTime }
    })

  await expect.poll(async () => (await readProgramMedia()).red).toBeGreaterThan(180)
  const retainedVideo = await program.locator('video').evaluateHandle((video) => video)
  expect(await page.evaluate(() => window.__freecutSourceRangeFixture.getLoadCount())).toBe(1)

  await page.evaluate(() => window.__freecutSourceRangeFixture.pushRangeB())

  await expect.poll(async () => (await readProgramMedia()).blue).toBeGreaterThan(180)
  await expect.poll(async () => (await readProgramMedia()).currentTime).toBeGreaterThan(1.9)
  expect(
    await program.locator('video').evaluate((video, previous) => video === previous, retainedVideo),
  ).toBe(true)
  expect(await page.evaluate(() => window.__freecutSourceRangeFixture.getLoadCount())).toBe(1)
  await retainedVideo.dispose()
})

test('standalone 390 keeps core controls in view and owns horizontal scroll in the time axis', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createProject(page, 'Standalone mobile regression')
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-editor-layout', 'mobile')

  const rootWidths = await page.evaluate(() => ({
    document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
    body: [document.body.clientWidth, document.body.scrollWidth],
    app: [
      document.querySelector<HTMLElement>('[role="application"]')!.clientWidth,
      document.querySelector<HTMLElement>('[role="application"]')!.scrollWidth,
    ],
  }))
  expect(rootWidths).toEqual({
    document: [390, 390],
    body: [390, 390],
    app: [390, 390],
  })

  for (const locator of [
    page.locator('[aria-label="Program monitor"]'),
    page.locator('[aria-label="Preview canvas region"]'),
    page.getByRole('button', { name: 'Play', exact: true }),
    page.locator('[data-timeline-track-strip]'),
    page.locator('[data-timeline-scroll-container]'),
    page.getByRole('button', { name: 'Back to projects' }),
    page.getByRole('button', { name: 'Save project' }),
    page.getByRole('button', { name: 'Export' }),
    page.getByRole('button', { name: 'More actions' }),
  ]) {
    await expectInside(locator, 390, 844)
  }

  const program = await page.locator('[aria-label="Program monitor"]').boundingBox()
  const timeline = await page.locator('[data-compact-timeline="true"]').boundingBox()
  expect(timeline!.y).toBeGreaterThanOrEqual(program!.y + program!.height - 1)
  const strip = await page.locator('[data-timeline-track-strip]').boundingBox()
  expect(strip!.width).toBe(80)
  await expect(page.locator('[data-audio-meter-panel="inline"]')).toHaveCount(0)

  for (const name of ['Media', 'Properties', 'Meters'] as const) {
    await openAndCloseDrawer(page, name)
  }

  await page.evaluate(async () => {
    const editorStoreModulePath = '/src/shared/state/editor/store.ts'
    const { useEditorStore } = await import(/* @vite-ignore */ editorStoreModulePath)
    useEditorStore.getState().setSourcePreviewMediaId('missing-source-fixture')
  })
  const sourceDrawer = page.getByRole('dialog', { name: 'Source' })
  await expect(sourceDrawer).toBeVisible()
  await expectInside(sourceDrawer, 390, 844)
  await page.keyboard.press('Escape')
  await expect(sourceDrawer).toBeHidden()

  const timeAxis = page.locator('[data-timeline-scroll-container]')
  const scrollMetrics = await timeAxis.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth)
  await timeAxis.evaluate((element) => {
    element.scrollLeft = 120
  })
  expect(await timeAxis.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('standalone-390.png') })
})

test('390px definite-height host uses the same responsive branch in a wide viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto('/tests/browser/host-responsive.html')
  const hostBox = page.locator('[data-host-box]')
  const app = page.locator('[role="application"]')
  await expect(app).toHaveAttribute('data-editor-layout', 'mobile')
  expect(await app.boundingBox()).toMatchObject({ width: 390, height: 720 })
  expect(await hostBox.evaluate((element) => [element.clientWidth, element.scrollWidth])).toEqual([
    390, 390,
  ])

  for (const name of ['Media', 'Properties', 'Meters'] as const) {
    const trigger = page.getByRole('button', { name, exact: true })
    await trigger.click()
    const drawer = page.getByRole('dialog', { name, exact: true })
    await expect(drawer).toBeVisible()
    const drawerBox = await drawer.boundingBox()
    const hostBounds = await hostBox.boundingBox()
    expect(drawerBox!.x).toBeGreaterThanOrEqual(hostBounds!.x)
    expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(hostBounds!.x + 390.5)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  }

  await page.evaluate(() =>
    (
      window as unknown as {
        __freecutHostFixture: { openSource(): void }
      }
    ).__freecutHostFixture.openSource(),
  )
  await expect(page.getByRole('dialog', { name: 'Source' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Source' })).toBeHidden()
  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('host-390.png') })
})

test('desktop 1440 retains the existing inline panel and meter geometry', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await createProject(page, 'Desktop geometry regression')
  await expect(page.locator('[role="application"]')).toHaveAttribute(
    'data-editor-layout',
    'desktop',
  )

  await expect
    .poll(() =>
      page.locator('[data-media-sidebar-panel]').evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBe(320)
  expect(
    await page
      .locator('[data-properties-sidebar="inline"]')
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(288)
  expect(
    await page
      .locator('[data-audio-meter-panel="inline"]')
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(84)
  expect(
    await page
      .locator('[data-timeline-track-strip]')
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(288)
  await expect(page.locator('[data-mobile-editor-panel-bar]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('desktop-1440.png') })
})
