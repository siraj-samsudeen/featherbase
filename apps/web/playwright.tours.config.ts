import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Tours (#1070): demo-length acceptance tests, one story each, that double as
// product videos. See docs/TESTING.md, "Tours".
//
// A tour runs against the app as people get it: the web app is BUILT and the
// API server serves it (one origin, as in production), on its own database
// (the developer's name with `_tours_e2e`, dropped, recreated and migrated per
// run). That reset is the one install a run pays; every tour starts from it.
//
// TOUR_URL=<origin> drives an instance that is already running instead (a
// preview deployment before a demo, or `./init.sh`'s stack while writing a
// tour). Nothing is built or reset then, so the tour's data stays behind.
//
// VIDEO=1 slows every action down, shows each chapter and step as a caption
// and records the tour as one video under test-results/. CI sets none of it.
const port = Number(process.env.TOUR_PORT ?? 8040)
const external = process.env.TOUR_URL
const video = process.env.VIDEO === '1'

function toursDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  const name = decodeURIComponent(url.pathname.slice(1)) || 'featherbase'
  url.pathname = `/${name.replace(/_(test|e2e)$/, '')}_tours_e2e`
  return url.toString()
}

// The same probe as playwright.config.ts: a container's browsers may be a
// different build from the one the pinned @playwright/test expects.
function resolveChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  try {
    for (const d of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const bin = join(root, d, ...rel.split('/'))
        if (existsSync(bin)) return bin
      }
    }
  } catch {
    /* no such root: Playwright's own resolution */
  }
  return undefined
}
const chromiumPath = resolveChromium()

export default defineConfig({
  testDir: './tours',
  testMatch: '*.tour.ts',
  // A tour is one long story; its chapters carry their own time limits.
  timeout: video ? 60 * 60_000 : 10 * 60_000,
  expect: { timeout: video ? 30_000 : 15_000 },
  // Tours write committed data to one database: one at a time.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tours-report' }]],
  outputDir: 'test-results/tours',
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      ...(video ? { slowMo: Number(process.env.VIDEO_SLOWMO ?? 250) } : {}),
    },
    // A control that never appears fails in seconds, not at the tour's timeout.
    actionTimeout: video ? 60_000 : 15_000,
    video: video ? { mode: 'on', size: { width: 1280, height: 800 } } : 'off',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? undefined
    : {
        // Build first, so the server serves this checkout's web app.
        command: 'pnpm --filter web build && pnpm --filter server e2e:serve',
        cwd: '../..',
        url: `http://localhost:${port}/api/ping`,
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          PORT: String(port),
          DATABASE_URL: toursDatabaseUrl(),
          FEATHERBASE_ENV: 'test',
          // A tour signs in many times over; the login limiter is not its subject.
          PREAUTH_LOGIN_MAX: '10000',
        },
      },
})
