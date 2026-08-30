import { expect, test, type Page } from 'playwright/test'

test.setTimeout(120_000)

test.describe('host authoritative delete/ripple', () => {
  test('Delete submits one ripple command and updates only after the receipt', async ({
    page,
  }: {
    page: Page
  }) => {
    await page.goto('/tests/browser/host-delete-ripple.html')
    await page.waitForSelector('[data-freecut-editor-surface="host"]')
    await page.waitForFunction(() => Boolean(window.__freecutDeleteRippleFixture))

    await page.evaluate(() => window.__freecutDeleteRippleFixture.selectClip())
    await page.keyboard.press('Delete')

    await page.waitForFunction(
      () => window.__freecutDeleteRippleFixture.getLastBatch()?.commands.length === 1,
    )
    const batch = await page.evaluate(() => window.__freecutDeleteRippleFixture.getLastBatch())
    expect(batch).toMatchObject({
      commands: [
        {
          type: 'ripple_delete',
          start_us: 0,
          end_us: 1_000_000,
          track_ids: null,
          item_ids: ['video-1'],
          intent: 'ripple',
        },
      ],
    })
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-1"]')).toHaveCount(1)
    await page.evaluate(() => window.__freecutDeleteRippleFixture.releaseReceipt())
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-1"]')).toHaveCount(0)
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-2"]')).toHaveCount(1)
    await page.screenshot({ path: 'artifacts/host-delete-ripple-after.png', fullPage: true })
  })

  test('right-click Delete uses the same authoritative ripple path', async ({
    page,
  }: {
    page: Page
  }) => {
    await page.goto('/tests/browser/host-delete-ripple.html')
    await page.waitForSelector('[data-freecut-editor-surface="host"]')
    await page.evaluate(() => window.__freecutDeleteRippleFixture.selectClip())

    await page
      .locator('[data-timeline-item="true"][data-item-id="video-1"]')
      .click({ button: 'right' })
    await page.screenshot({ path: 'artifacts/host-delete-ripple-menu.png', fullPage: true })
    await page.getByRole('menuitem', { name: /^Delete/ }).click()

    await page.waitForFunction(
      () => window.__freecutDeleteRippleFixture.getLastBatch()?.commands.length === 1,
    )
    const batch = await page.evaluate(() => window.__freecutDeleteRippleFixture.getLastBatch())
    expect(batch?.commands[0]).toMatchObject({
      type: 'ripple_delete',
      item_ids: ['video-1', 'audio-1', 'caption-1'],
    })
    await page.evaluate(() => window.__freecutDeleteRippleFixture.releaseReceipt())
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-1"]')).toHaveCount(0)
  })

  test('rejected Delete keeps state and allows a successful retry', async ({ page }) => {
    await page.goto('/tests/browser/host-delete-ripple.html')
    await page.waitForSelector('[data-freecut-editor-surface="host"]')
    await page.waitForFunction(() => Boolean(window.__freecutDeleteRippleFixture))

    await page.evaluate(() => {
      window.__freecutDeleteRippleFixture.selectClip()
      window.__freecutDeleteRippleFixture.rejectNextDelete()
    })
    await page.keyboard.press('Delete')
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-1"]')).toHaveCount(1)
    await expect(page.locator('body')).toHaveAttribute(
      'data-last-notice',
      'Host rejected the timeline delete; retry is available',
    )

    const rejectedBatch = await page.evaluate(() =>
      window.__freecutDeleteRippleFixture.getLastBatch(),
    )
    await page.keyboard.press('Delete')
    await page.waitForFunction(
      (previousId) =>
        window.__freecutDeleteRippleFixture.getLastBatch()?.idempotency_key !== previousId,
      rejectedBatch?.idempotency_key,
    )
    await page.evaluate(() => window.__freecutDeleteRippleFixture.releaseReceipt())
    await expect(page.locator('[data-timeline-item="true"][data-item-id="video-1"]')).toHaveCount(0)
    await page.screenshot({ path: 'artifacts/host-delete-ripple-retry.png', fullPage: true })
  })
})
