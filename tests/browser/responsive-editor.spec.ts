import { expect, test, type Page } from 'playwright/test'

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

  await page.evaluate(() => window.__freecutHostFixture.openSource())
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
