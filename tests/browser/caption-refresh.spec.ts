import { execFileSync } from 'node:child_process'
import { unlinkSync, mkdirSync } from 'node:fs'
import { expect, test } from 'playwright/test'
const media = 'tests/browser/.caption-generated.webm'
test.beforeAll(() => {
  mkdirSync('artifacts/qa/captions', { recursive: true })
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:v',
      'libvpx-vp9',
      '-c:a',
      'libopus',
      media,
    ],
    { stdio: 'ignore' },
  )
})
test.afterAll(() => unlinkSync(media))
test.setTimeout(120_000)
test('More discovers captions; edited occurrence timing, style and one apply survive Library navigation', async ({
  page,
}) => {
  await page.goto('/tests/browser/caption-refresh.html')
  await page.locator('[data-item-id]').first().waitFor()
  await page.getByRole('combobox', { name: 'More library tools' }).selectOption('captions')
  await expect(page.getByRole('heading', { name: 'Create captions', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Chat draft' }).fill('Keep this draft')
  await page.getByRole('button', { name: 'Preview captions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply captions', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).captionFixture.applies)).toBe(0)
  await expect(page.getByText('1.00–2.00s')).toBeVisible()
  await page.getByRole('button', { name: 'Apply captions', exact: true }).click()
  await expect(page.getByTestId('caption-editor')).toBeVisible()
  expect(await page.evaluate(() => (window as any).captionFixture.applies)).toBe(1)
  const cues = await page.evaluate(
    () =>
      (window as any).captionFixture
        .snapshot()
        .timeline.tracks.find((track: any) => track.kind === 'caption').items,
  )
  expect(cues.map((cue: any) => [cue.text, cue.from, cue.durationInFrames])).toEqual([
    ['HELLO', 0, 30],
    ['WORLD', 30, 30],
    ['HELLO UM WORLD', 60, 90],
  ])
  await page.getByRole('button', { name: /Seek to cue 2 at frame 30/ }).click()
  await page.getByLabel('Color', { exact: true }).fill('#ffff00')
  await expect(page.getByTestId('caption-preview').getByText('WORLD', { exact: true })).toHaveCSS(
    'color',
    'rgb(255, 255, 0)',
  )
  await page.getByRole('button', { name: 'Apply style', exact: true }).click()
  await page.getByRole('button', { name: 'Media', exact: true }).click()
  await page.getByRole('combobox', { name: 'More library tools' }).selectOption('captions')
  await expect(page.getByLabel('Color', { exact: true })).toHaveValue('#ffff00')
  await expect(page.getByRole('textbox', { name: 'Chat draft' })).toHaveValue('Keep this draft')
  const native = await page.evaluate(() => (window as any).captionFixture.native())
  expect(native.items.find((item: any) => item.text === 'WORLD').color).toBe('#ffff00')
  const renderPage = await page.context().newPage()
  await renderPage.goto('/headless.html')
  await renderPage.waitForFunction(() => Boolean((window as any).freecut?.ready))
  const downloadPromise = renderPage.waitForEvent('download', { timeout: 120_000 })
  const summary = await renderPage.evaluate(
    (native) =>
      (window as any).freecut.renderTimeline({
        ...native,
        width: 640,
        height: 360,
        media: [
          {
            mediaId: 'fixture',
            url: 'http://127.0.0.1:4195/tests/browser/.caption-generated.webm',
          },
        ],
        settings: {
          mode: 'video',
          codec: 'vp9',
          audioCodec: 'opus',
          container: 'webm',
          quality: 'high',
          resolution: { width: 640, height: 360 },
          fps: 30,
          audioBitrate: 128000,
        },
        outputFileName: 'caption-export.webm',
      }),
    native,
  )
  await (await downloadPromise).saveAs('artifacts/qa/captions/caption-export.webm')
  expect(summary).toBeTruthy()
  for (const [name, time] of [
    ['hello', '0.5'],
    ['world', '1.5'],
    ['repeat', '3.5'],
  ])
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        time!,
        '-i',
        'artifacts/qa/captions/caption-export.webm',
        '-frames:v',
        '1',
        `artifacts/qa/captions/export-${name}.png`,
      ],
      { stdio: 'ignore' },
    )
  await renderPage.close()
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `artifacts/qa/captions/library-${width}.png` })
  }
  await page.getByRole('checkbox', { name: /Replace all cues/ }).check()
  await page.getByRole('button', { name: 'Preview captions', exact: true }).click()
  await page.getByRole('button', { name: 'Apply captions', exact: true }).click()
  await expect(page.getByTestId('caption-editor')).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as any).captionFixture
          .snapshot()
          .timeline.tracks.find((track: any) => track.kind === 'caption').items.length,
    ),
  ).toBe(3)
})

for (const [scenario, message] of [
  ['unsupported', 'This host needs support for captions bound to edited clip occurrences.'],
  ['pending', 'Transcription is still processing.'],
  ['missing', 'A completed transcript is needed.'],
  ['error', 'Fixture preview unavailable.'],
]) {
  test(`caption recovery: ${scenario}`, async ({ page }) => {
    await page.goto(`/tests/browser/caption-refresh.html?scenario=${scenario}`)
    await page.locator('[data-item-id]').first().waitFor()
    await page.getByRole('combobox', { name: 'More library tools' }).selectOption('captions')
    const preview = page.getByRole('button', { name: 'Preview captions', exact: true })
    if (scenario === 'unsupported') await expect(preview).toBeDisabled()
    else await preview.click()
    await expect(page.getByText(message, { exact: false })).toBeVisible()
    expect(await page.evaluate(() => (window as any).captionFixture.applies)).toBe(0)
  })
}
test('selected occurrence captions undo in one transaction', async ({ page }) => {
  await page.goto('/tests/browser/caption-refresh.html')
  await page.locator('[data-item-id="after-cut"][role="button"]').click()
  await page.getByRole('combobox', { name: 'More library tools' }).selectOption('captions')
  await page.getByLabel('Caption scope').selectOption('selected')
  await page.getByRole('button', { name: 'Preview captions', exact: true }).click()
  await page.getByRole('button', { name: 'Apply captions', exact: true }).click()
  await expect(page.getByTestId('caption-editor')).toBeVisible()
  const cues = await page.evaluate(
    () =>
      (window as any).captionFixture
        .snapshot()
        .timeline.tracks.find((track: any) => track.kind === 'caption').items,
  )
  expect(cues.map((cue: any) => [cue.text, cue.from, cue.durationInFrames])).toEqual([
    ['WORLD', 30, 30],
  ])
  await page.evaluate(() => (window as any).captionFixture.undo())
  await expect(page.getByTestId('caption-editor-empty')).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as any).captionFixture
          .snapshot()
          .timeline.tracks.flatMap((track: any) => track.items).length,
    ),
  ).toBe(3)
})

for (const returnToFirst of [false, true]) {
  test(`pending selected caption preview rejects A→B${returnToFirst ? '→A' : ''}`, async ({
    page,
  }) => {
    await page.goto('/tests/browser/caption-refresh.html?scenario=deferred')
    const first = page.locator('[data-item-id="first"][role="button"]')
    const second = page.locator('[data-item-id="after-cut"][role="button"]')
    await first.click()
    await page.getByRole('combobox', { name: 'More library tools' }).selectOption('captions')
    await page.getByLabel('Caption scope').selectOption('selected')
    await page.getByRole('button', { name: 'Preview captions', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).captionFixture.requests.length))
      .toBe(1)
    await second.click()
    if (returnToFirst) await first.click()
    await page.evaluate(() => (window as any).captionFixture.resolvePreview())
    await expect(page.getByRole('alert')).toContainText('selection changed')
    await expect(page.getByRole('button', { name: 'Apply captions', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).captionFixture.applies)).toBe(0)
    await page.getByRole('button', { name: 'Preview captions', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).captionFixture.requests.length))
      .toBe(2)
    expect(
      await page.evaluate(() =>
        (window as any).captionFixture.requests[1].ranges.map((range: any) => range.itemId),
      ),
    ).toEqual([returnToFirst ? 'first' : 'after-cut'])
    await page.evaluate(() => (window as any).captionFixture.resolvePreview())
    await page.getByRole('button', { name: 'Apply captions', exact: true }).click()
    expect(await page.evaluate(() => (window as any).captionFixture.applies)).toBe(1)
  })
}
