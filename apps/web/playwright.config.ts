import { defineConfig } from '@playwright/test'

// Only override the browser binary when the environment names one (the
// container installs Chromium outside Playwright's own cache). Everywhere
// else, let Playwright resolve the browser it installed itself.
const chromiumPath = process.env.CHROMIUM_PATH

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // One worker, for the same reason the vitest suites set
  // `fileParallelism: false`: every spec drives the one shared server and
  // database, and several mutate global state (System Settings, the active
  // language, client scripts). Playwright otherwise defaults to half the
  // host's cores — harmless on a 2-core container, but on a developer machine
  // the specs race and fail differently on every run.
  workers: 1,
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  reporter: [['list']],
})
