import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Resolve the Chromium binary the same way `apps/server/src/print.ts` does,
// and for the same reason: CLAUDE.md's environment rule says Chromium is
// resolved from the environment and never hardcoded.
//
// Preferring Playwright's own resolution is not enough on a prebuilt
// container. The image installs browsers under /opt/pw-browsers at whatever
// build the image was made with, while the pinned @playwright/test expects
// the build IT ships with — when those drift, Playwright looks for a
// directory that was never installed and every spec dies before its first
// assertion ("Executable doesn't exist at .../chromium_headless_shell-<n>").
// That took out `./init.sh`'s smoke gate on a stack that was otherwise
// healthy, which is the worst kind of failure: loud, total, and about
// nothing.
//
// So: an explicit CHROMIUM_PATH wins; otherwise probe the container's
// browsers root and take the newest Chromium actually present. The probe is
// naturally inert anywhere that root does not exist, so a developer machine
// still uses the browser Playwright installed for itself.
const CHROMIUM_BINARIES = [
  'chrome-linux/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
]

function resolveChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH))
    return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  try {
    // Newest build first: 'chromium-1228' sorts above 'chromium-1194'.
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const d of dirs) {
      for (const rel of CHROMIUM_BINARIES) {
        const bin = join(root, d, ...rel.split('/'))
        if (existsSync(bin)) return bin
      }
    }
  } catch {
    /* no such root — fall through to Playwright's own resolution */
  }
  return undefined
}

const chromiumPath = resolveChromium()

// ISOLATED MODE (`pnpm --filter web e2e`, which sets E2E_ISOLATED=1).
//
// Playwright brings up its OWN stack — its own database, its own API and web
// ports — resets that database first, and tears the stack down after. Three
// things follow, all of which the suite needed:
//
//   * Repeatable runs. e2e writes are real commits, outside any sandbox
//     transaction, so rows used to survive into the next run. Specs papered
//     over that with hand-rolled `beforeAll` cleanup, which is invisible when
//     it breaks — #132 renamed the field three of them deleted by, so they
//     deleted nothing and leaked silently until #183. A reset the suite does
//     not have to remember removes the whole class.
//   * The developer's database stops being collateral. e2e used to drive the
//     dev server, committing its fixtures into the database being used for
//     actual work.
//   * Ports that do not collide with a running `./init.sh`.
//
// Ports are overridable (E2E_API_PORT / E2E_WEB_PORT) because parallel
// checkouts are normal here — Playwright refuses to start if its port is
// taken rather than silently testing somebody else's stack.
//
// Without E2E_ISOLATED the config behaves exactly as before: drive whatever
// stack is already running. `./init.sh` relies on that for its smoke check —
// the point there is to prove the stack IT just booted works, so it must not
// get a private one.
const isolated = process.env.E2E_ISOLATED === '1'
const apiPort = Number(process.env.E2E_API_PORT ?? 8020)
const webPort = Number(process.env.E2E_WEB_PORT ?? 5193)
const baseURL = isolated
  ? `http://localhost:${webPort}`
  : (process.env.WEB_URL ?? 'http://localhost:5173')

// The e2e database, derived from the developer's own so it lands on the same
// host and credentials. Computed HERE and passed explicitly to both the reset
// and the server, so the two cannot disagree about which database is being
// reset — deriving it independently in each process would let a stray
// NODE_ENV send them to different names.
function e2eDatabaseUrl(): string {
  const base =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/featherbase'
  const url = new URL(base)
  const name = decodeURIComponent(url.pathname.slice(1)) || 'featherbase'
  const stem = name.replace(/_(test|e2e)$/, '')
  url.pathname = `/${stem}_e2e`
  return url.toString()
}

// The reset runs as part of the API server's own start command rather than in
// a globalSetup, so the ordering is guaranteed by construction: the database
// cannot be dropped after the server has connected to it.
const apiCommand = 'pnpm --filter server e2e:serve'

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
    baseURL,
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
    // Retain screenshots and traces on failure so CI failures leave something to examine.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: isolated
    ? [
        {
          command: apiCommand,
          cwd: '../..',
          url: `http://localhost:${apiPort}/api/ping`,
          reuseExistingServer: false,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            PORT: String(apiPort),
            DATABASE_URL: e2eDatabaseUrl(),
            // FEATHERBASE_ENV rather than NODE_ENV: the migrator must stamp this
            // database for the 'test' environment (which is what lets the reset
            // agree to drop it next time), but src/index.ts skips starting the
            // HTTP listener entirely when NODE_ENV === 'test' — the vitest suites
            // import the app in-process instead. Setting NODE_ENV here produces a
            // server that migrates, prints nothing, and never binds.
            FEATHERBASE_ENV: 'test',
            // The e2e specs drive the mock OAuth provider, which is opt-in and
            // fails closed. Matches what init.sh does for a dev machine.
            ALLOW_MOCK_OAUTH: '1',
            WEB_ORIGINS: `http://localhost:${webPort}`,
          },
        },
        {
          command: 'pnpm --filter web dev',
          cwd: '../..',
          url: `http://localhost:${webPort}`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: { WEB_PORT: String(webPort), API_PORT: String(apiPort) },
        },
      ]
    : undefined,
  reporter: [['list']],
})
