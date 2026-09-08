import { defineConfig } from 'playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'layout-refresh.spec.ts',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4186',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
