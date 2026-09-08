// fallow-ignore-file unused-file
// Invoked explicitly by the caption browser QA command.
import { defineConfig } from 'playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'caption-refresh.spec.ts',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4195',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
