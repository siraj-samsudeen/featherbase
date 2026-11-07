import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// #642 (E4): the SERVED stack (`pnpm --filter web e2e:served`). A page's frame
// policy is a response header the API server sets on the document it serves,
// and the main e2e stack serves pages from the Vite dev server, which sets
// none. So this stack builds the web app and lets the API server serve it, as
// production does (#57, one origin), and its specs read real headers.
//
// Like the main isolated stack it owns everything: its own database (the
// developer's name with `_served_e2e`, dropped and recreated per run) and its
// own port. Nothing remote is touched: no job ticks (JOB_POLL_MS).
const port = Number(process.env.E2E_SERVED_PORT ?? 8030)

function servedDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  const name = decodeURIComponent(url.pathname.slice(1)) || 'featherbase'
  url.pathname = `/${name.replace(/_(test|e2e)$/, '')}_served_e2e`
  return url.toString()
}

const chromiumPath = process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH) ? process.env.CHROMIUM_PATH : undefined

export default defineConfig({
  testDir: './e2e-served',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Build first, so the server serves this checkout's web app, never a stale one.
    command: 'pnpm --filter web build && pnpm --filter server e2e:serve',
    cwd: '../..',
    url: `http://localhost:${port}/api/ping`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(port),
      DATABASE_URL: servedDatabaseUrl(),
      FEATHERBASE_ENV: 'test',
      // #650: an app with its own page, to check the built bar bundle over it
      // (e2e-served/app-page-bar.spec.ts), and the app that gives its picker
      // its options.
      FEATHERBASE_APP_PATHS: JSON.stringify([
        fileURLToPath(new URL('../../test-apps/fixtures/bar-proof', import.meta.url)),
        fileURLToPath(new URL('../../test-apps/fixtures/place-roster', import.meta.url)),
      ]),
      ALLOW_MOCK_OAUTH: '1',
      PREAUTH_LOGIN_MAX: '10000',
      JOB_POLL_MS: '3600000',
    },
  },
  reporter: [['list']],
})
