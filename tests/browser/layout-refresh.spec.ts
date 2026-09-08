import { execFileSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { expect, test } from 'playwright/test'

const fixtureMedia = 'tests/browser/.layout-refresh-generated.webm'
test.beforeAll(() =>
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=30:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'libvpx-vp9',
      '-c:a',
      'libopus',
      fixtureMedia,
    ],
    { stdio: 'ignore' },
  ),
)
test.afterAll(() => unlinkSync(fixtureMedia))

test('independent columns preserve draft/search and restore from every combination', async ({
  page,
}) => {
  await page.goto('/tests/browser/layout-refresh.html')
  await page.locator('[data-item-id]').first().waitFor()
  await page.getByRole('button', { name: 'Transcript', exact: true }).click()
  await expect(
    page.getByText('A calmer workspace makes room for your ideas.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('textbox', { name: 'Chat draft' }).fill('Keep this unsent draft')
  const search = page.getByPlaceholder('Search transcript')
  await search.fill('keep')
  for (const width of [1440, 1280, 760]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `/tmp/ux7144-pr1-${width}-expanded.png` })
    for (const column of ['Chat', 'Library', 'Editor']) {
      await page.getByRole('button', { name: `Hide ${column}`, exact: true }).click()
      await page.screenshot({
        path: `/tmp/ux7144-pr1-${width}-${column.toLowerCase()}-collapsed.png`,
      })
      await page.getByRole('button', { name: `Show ${column}`, exact: true }).click()
    }
    await expect(page.getByRole('textbox', { name: 'Chat draft' })).toHaveValue(
      'Keep this unsent draft',
    )
    await expect(search).toHaveValue('keep')
  }
  await page.setViewportSize({ width: 760, height: 900 })
  await page.getByRole('button', { name: 'Hide Chat', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Library', exact: true }).click()
  await page.screenshot({ path: '/tmp/ux7144-pr1-760-editor-focused.png' })
  const exportBounds = await page.getByRole('button', { name: 'Export', exact: true }).boundingBox()
  expect(exportBounds!.x + exportBounds!.width).toBeLessThanOrEqual(760)
  await page.getByRole('button', { name: 'Show Chat', exact: true }).click()
  await page.getByRole('button', { name: 'Show Library', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Hide Editor', exact: true }).click()
  const libraryWidth = await page
    .locator('[data-editor-column="library"]')
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(libraryWidth).toBeGreaterThan(1000)
  await page.getByRole('button', { name: 'Hide Library', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Chat', exact: true }).click()
  await page.screenshot({ path: '/tmp/ux7144-pr1-all-collapsed.png' })
  for (const column of ['Chat', 'Library', 'Editor'])
    await page.getByRole('button', { name: `Show ${column}`, exact: true }).click()
  const separator = page.getByRole('separator', { name: 'Resize Library' })
  await expect(page.getByText('00:00:00', { exact: true })).toBeVisible()
  const clipCount = await page.locator('[data-item-id]').count()
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '296')
  await expect(page.getByText('00:00:00', { exact: true })).toBeVisible()
  await page.keyboard.press('Space')
  await page.keyboard.press('Backspace')
  expect(await page.locator('[data-item-id]').count()).toBe(clipCount)
  expect(
    await page.locator('video').evaluateAll((videos) => videos.every((video) => video.paused)),
  ).toBe(true)
  await page.getByRole('button', { name: 'Canvas settings', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/ux7144-pr1-settings.png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Settings', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Canvas settings', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toHaveCount(1)
})
