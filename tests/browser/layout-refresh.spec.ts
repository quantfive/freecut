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
    await page
      .locator('video')
      .evaluateAll((videos) => videos.every((video) => (video as HTMLVideoElement).paused)),
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

test('hiding Editor pauses a playing source monitor without losing its frame', async ({ page }) => {
  await page.goto('/tests/browser/layout-refresh.html')
  await page.locator('[data-item-id]').first().waitFor()
  await page.getByRole('button', { name: 'Media', exact: true }).click()
  await page.getByText('generated-source-range.webm', { exact: true }).first().dblclick()
  await page.getByRole('button', { name: 'Close source monitor', exact: true }).waitFor()
  const sourceState = () =>
    page.evaluate(async (modulePath) => {
      const { useSourcePlayerStore } = await import(modulePath)
      const state = useSourcePlayerStore.getState()
      return { playing: state.playerMethods?.isPlaying(), frame: state.currentSourceFrame }
    }, '/src/shared/state/source-player/store.ts')
  const timelineState = () =>
    page.evaluate(async (modulePath) => {
      const { usePlaybackStore } = await import(modulePath)
      return usePlaybackStore.getState().isPlaying
    }, '/src/shared/state/playback/index.ts')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect.poll(async () => (await sourceState()).playing).toBe(true)
  await expect.poll(async () => (await sourceState()).frame).toBeGreaterThan(0)
  expect(await timelineState()).toBe(false)
  await page.getByRole('button', { name: 'Hide Editor', exact: true }).click()
  await expect(page.locator('[data-editor-column="editor"]')).toBeHidden()
  expect((await sourceState()).playing).toBe(false)
  const pausedFrame = (await sourceState()).frame
  // Observe beyond several real source clock ticks, not just the pause callback.
  await page.waitForTimeout(250)
  expect((await sourceState()).frame).toBe(pausedFrame)
  await page.getByRole('button', { name: 'Show Editor', exact: true }).click()
  expect((await sourceState()).frame).toBe(pausedFrame)
  expect((await sourceState()).playing).toBe(false)
  await expect(page.getByRole('button', { name: 'Close source monitor', exact: true })).toBeVisible()
})

test('host removal closes stale settings without stealing chat focus', async ({ page }) => {
  await page.goto('/tests/browser/layout-refresh.html')
  const clip = page.locator('[data-timeline-item][data-item-id="retained-video"]').first()
  await clip.click()
  await page.getByRole('button', { name: 'Clip settings', exact: true }).click()
  const chat = page.getByRole('textbox', { name: 'Chat draft' })
  await chat.fill('Keep typing')
  await page.evaluate(() => window.__layoutHarness.removeClip())
  await expect(page.getByRole('region', { name: 'Settings', exact: true })).toHaveCount(0)
  await expect(chat).toBeFocused()
  await page.keyboard.type(' here')
  await expect(chat).toHaveValue('Keep typing here')
})

test('actual Hide Editor cancels a held body move before late mouseup', async ({ page }) => {
  await page.goto('/tests/browser/layout-refresh.html')
  await page.getByRole('button', { name: 'Hide Library', exact: true }).click()
  const clip = page.locator('[data-timeline-item][data-item-id="retained-video"]').first()
  await clip.waitFor()
  const bounds = await clip.boundingBox()
  const x = bounds!.x + Math.min(bounds!.width / 2, 80)
  const y = bounds!.y + bounds!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 110, y, { steps: 6 })
  await expect
    .poll(() => clip.evaluate((element) => (element.parentElement as HTMLElement).style.transform))
    .not.toBe('')
  await expect.poll(() => page.evaluate(() => window.__layoutHarness.state().dragging)).toBe(true)
  await page.getByRole('button', { name: 'Hide Editor', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-editor-column="editor"]')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__layoutHarness.state().dragging)).toBe(false)
  await page.getByRole('button', { name: 'Show Editor', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.mouse.up()
  await expect(clip).toBeVisible()
  const state = await page.evaluate(() => window.__layoutHarness.state())
  expect(state.submitCount).toBe(0)
  expect(state.snapshot.timeline.tracks[0]!.items[0]!.from).toBe(0)
})
