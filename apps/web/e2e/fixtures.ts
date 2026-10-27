// The e2e suite's fixture seam — and, since #216, its single auth story.
// Both `test` and `anonymousTest` are backed by the feather-testing-core DSL:
// every spec gets a `session` fixture, whether or not it uses one yet.
//
// WHICH `test` A SPEC IMPORTS *IS* ITS AUTH STORY:
//
//   import { test } from './fixtures'
//       Already signed in as Administrator. The browser context starts from a
//       storageState captured once per worker, so the spec navigates straight
//       to `/admin/...` — no `/login` round trip, no local `login(page)`
//       helper. This is the right import for the ~70 specs whose subject is
//       something *behind* the login, not the login itself. `{ session }` is
//       the feather-testing-core DSL entry point (framework Part I §6:
//       journeys compile to fluent chains) — behaviour goes through Session
//       verbs, mechanics the DSL can't express go in a named `session.step()`.
//
//   import { anonymousTest as test } from './fixtures'
//       Signed out — no stored session, so the spec drives `/login` itself
//       with `loginAs()` or `signIn(session)` below. Correct when the login
//       surface IS the subject (smoke, admin, account-menu, i18n-login,
//       oauth, palette, user-management), when the identity that matters is
//       NOT Administrator (portal, realtime), or when the page under test
//       must be reached with no session at all (web-page, web-form). Also
//       DSL-backed, for the same reason `test` is.
//
// The request-side setup every spec does (`POST /api/login` for a bearer
// token) collapses to the `adminAuth()` / `adminToken()` helpers here. They
// are helpers rather than a fixture on purpose: the majority of call sites are
// `test.beforeAll`, and a token fixture would have to be worker-scoped to be
// addressable there — while no single test calls it twice, so a fixture would
// save nothing and only add a second way to say the same thing.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { test as dslTest } from 'feather-testing-core/playwright'

export { expect }
export type { APIRequestContext, Page }

export const ADMIN_USER = 'Administrator'
export const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

/** Authorization header pair for a bearer token. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` }
}

/** API sign-in: the token for any user. */
export async function tokenFor(
  request: APIRequestContext,
  usr: string,
  pwd: string,
): Promise<string> {
  const res = await request.post('/api/login', { data: { usr, pwd } })
  if (!res.ok()) throw new Error(`login as ${usr}: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { token: string }).token
}

/** API sign-in as Administrator. */
export function adminToken(request: APIRequestContext): Promise<string> {
  return tokenFor(request, ADMIN_USER, ADMIN_PWD)
}

/** API sign-in as Administrator, as ready-to-spread request headers. */
export async function adminAuth(request: APIRequestContext): Promise<{ Authorization: string }> {
  return bearer(await adminToken(request))
}

/** Install a runtime app if needed and return headers pinned to active app versions. */
/**
 * A role that opens the Admin to a person (#410): a read grant of their own on
 * Person. A role-less person lands on the no-access page, so a spec that needs
 * its test user inside the Admin gives them this role. Idempotent.
 */
export const ADMIN_READER_ROLE = 'E2E Admin Reader'
export async function ensureAdminReaderRole(request: APIRequestContext): Promise<string> {
  const headers = await adminAuth(request)
  const role = await request.get(`/api/table/Role/${encodeURIComponent(ADMIN_READER_ROLE)}`, { headers })
  if (role.status() !== 200) {
    const made = await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: ADMIN_READER_ROLE } } })
    if (made.status() !== 201) throw new Error(`create role: ${made.status()} ${await made.text()}`)
  }
  const filters = encodeURIComponent(JSON.stringify([['role', '=', ADMIN_READER_ROLE]]))
  const grants = (await (await request.get(`/api/table/Permission?filters=${filters}`, { headers })).json()) as { data: unknown[] }
  if (!grants.data.length) {
    const made = await request.post('/api/save_row', {
      headers,
      data: { table: 'Permission', row: { ref_table: 'Person', role: ADMIN_READER_ROLE, can_read: true } },
    })
    if (made.status() !== 201) throw new Error(`create grant: ${made.status()} ${await made.text()}`)
  }
  return ADMIN_READER_ROLE
}

export async function ensureRuntimeApp(
  request: APIRequestContext,
  name: string,
): Promise<{ Authorization: string; 'X-Featherbase-App-Version': string }> {
  const auth = await adminAuth(request)
  let versions = (await (await request.get('/api/runtime_app_versions', { headers: auth })).json()) as string[]
  if (!versions.some((version) => version.startsWith(`${name}@`))) {
    const installed = await request.post('/api/install_app', { headers: auth, data: { name } })
    if (![201, 409].includes(installed.status()))
      throw new Error(`install ${name}: ${installed.status()} ${await installed.text()}`)
    versions = (await (await request.get('/api/runtime_app_versions', { headers: auth })).json()) as string[]
  }
  if (!versions.some((version) => version.startsWith(`${name}@`)))
    throw new Error(`runtime app ${name} is not active after installation`)
  return { ...auth, 'X-Featherbase-App-Version': versions.join(', ') }
}

/**
 * Interactive sign-in through the real login form. The one implementation the
 * suite has: specs used to carry ~70 subtly different copies of it, half
 * waiting on `waitForURL` and half asserting `toHaveURL`.
 *
 * `landing` exists because not every account lands in `/admin` — a website
 * user lands in `/portal`.
 */
export async function loginAs(
  page: Page,
  usr: string = ADMIN_USER,
  pwd: string = ADMIN_PWD,
  landing: RegExp = /\/admin/,
): Promise<void> {
  await page.goto('/login')
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', pwd)
  await page.click('button[type=submit]')
  await page.waitForURL(landing)
}

/**
 * Wait until this page's realtime socket holds a SERVER-ACKNOWLEDGED
 * subscription to `channel`.
 *
 * A subscribe frame is asynchronous: an event published before the server
 * has authorized and recorded the channel is simply missed. The realtime
 * client mirrors the channels the server acked onto
 * `<html data-realtime-channels>` (#224), so a spec that is about to make
 * *another* session publish can wait on that fact instead of sleeping a
 * second and hoping.
 */
export async function waitForRealtime(page: Page, channel: string): Promise<void> {
  await page.waitForFunction((ch) => {
    const raw = document.documentElement.dataset.realtimeChannels
    return !!raw && (JSON.parse(raw) as string[]).includes(ch)
  }, channel)
}

// ---------------------------------------------------------------------------
// Merged web coverage (ADR 0012). Under `E2E_COVERAGE=1` the web dev server is
// Istanbul-instrumented (vite.config.ts), so every document the browser loads
// carries `window.__coverage__`. A document's counters die with it, so each
// document is read exactly once, in one of two ways:
//
//   * still open when the test ends: read directly, maps and counters;
//   * unloaded by a navigation: its counters are written to sessionStorage on
//     `pagehide`, and the NEXT document on that origin hands them to Node as
//     it starts. (Calling back into Node from `pagehide` itself does not
//     work: the binding's message is lost with the dying document, which left
//     every page a spec navigated away from uncounted.) Only the counters are
//     kept — the maps are bulky and identical in every document — and they
//     are matched to their file's maps by the instrumentation hash.
//
// Counters are summed per worker and written once, at worker teardown, to
// `apps/web/.nyc_output/e2e-<uuid>.json` — one file per worker rather than per
// test, because a document's coverage object spans the whole app and a file
// per test would run to gigabytes over the suite. A worker restarted after a
// failure writes its own file. `pnpm --filter web coverage:merged` remaps and
// merges these with the jsdom run's output.
//
// Off (the default), none of this runs: no binding, no init script.
// ---------------------------------------------------------------------------
const COVERAGE = process.env.E2E_COVERAGE === '1'
const NYC_OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.nyc_output')

interface FileCounters {
  hash?: string
  s: Record<string, number>
  f: Record<string, number>
  b: Record<string, number[]>
}
/** A file's full coverage: counters plus the maps they index (kept opaque). */
type FileCoverage = FileCounters & { statementMap?: unknown }
type CoverageData = Record<string, FileCoverage>

function addCounters(have: FileCounters, cov: FileCounters): void {
  for (const k of Object.keys(cov.s)) have.s[k] = (have.s[k] ?? 0) + cov.s[k]
  for (const k of Object.keys(cov.f)) have.f[k] = (have.f[k] ?? 0) + cov.f[k]
  for (const k of Object.keys(cov.b)) have.b[k] = cov.b[k].map((n, i) => (have.b[k]?.[i] ?? 0) + n)
}

interface BrowserCoverage {
  /** Full coverage, one map per distinct instrumentation of a file. */
  totals: CoverageData[]
  /** Counters handed over before any full read of their file arrived. */
  pending: Record<string, FileCounters>[]
}

/** Sum one document's full coverage into the worker's running totals. */
function addDocument(into: BrowserCoverage, doc: CoverageData): void {
  for (const [file, cov] of Object.entries(doc)) {
    // The same file instrumented twice (a different hash) has different
    // counter maps, so it is kept apart rather than summed into nonsense.
    let map = into.totals.find((t) => !t[file] || t[file].hash === cov.hash)
    if (!map) into.totals.push((map = {}))
    if (map[file]) addCounters(map[file], cov)
    else map[file] = cov
  }
}

/** Sum counters handed over from an unloaded document; returns those whose maps are not known yet. */
function addHandedOver(into: BrowserCoverage, doc: Record<string, FileCounters>): Record<string, FileCounters> {
  const unplaced: Record<string, FileCounters> = {}
  for (const [file, cov] of Object.entries(doc)) {
    const have = into.totals.find((t) => t[file]?.hash === cov.hash)?.[file]
    if (have) addCounters(have, cov)
    else unplaced[file] = cov
  }
  return unplaced
}

interface CoverageWorkerFixtures {
  /** This worker's summed browser coverage; written to .nyc_output at teardown. */
  browserCoverage: BrowserCoverage
}

const coverageTest = dslTest.extend<{ context: BrowserContext }, CoverageWorkerFixtures>({
  browserCoverage: [
    async ({}, use) => {
      const state: BrowserCoverage = { totals: [], pending: [] }
      await use(state)
      if (!COVERAGE) return
      // Counters that arrived before their file's maps: place them now.
      const unplaced = state.pending.map((doc) => addHandedOver(state, doc)).reduce((n, d) => n + Object.keys(d).length, 0)
      if (unplaced) console.warn(`coverage: ${unplaced} handed-over file counters had no matching instrumentation and were dropped`)
      if (state.totals.length === 0) return
      fs.mkdirSync(NYC_OUTPUT, { recursive: true })
      for (const data of state.totals)
        fs.writeFileSync(path.join(NYC_OUTPUT, `e2e-${randomUUID()}.json`), JSON.stringify(data))
    },
    { scope: 'worker' },
  ],
  context: async ({ context, browserCoverage }, use) => {
    if (!COVERAGE) return use(context)
    await context.exposeFunction('__featherbaseCoverage', (json: string) => {
      const unplaced = addHandedOver(browserCoverage, JSON.parse(json) as Record<string, FileCounters>)
      if (Object.keys(unplaced).length) browserCoverage.pending.push(unplaced)
    })
    await context.addInitScript(() => {
      const KEY = '__featherbaseCoverage'
      type W = { __coverage__?: Record<string, { hash?: string; s: unknown; f: unknown; b: unknown }>; __featherbaseCoverage?: (json: string) => void }
      const w = window as unknown as W
      try {
        const left = sessionStorage.getItem(KEY)
        if (left) {
          sessionStorage.removeItem(KEY)
          void w.__featherbaseCoverage?.(left)
        }
      } catch {
        /* storage blocked on this page: nothing was left here either */
      }
      addEventListener('pagehide', () => {
        if (!w.__coverage__) return
        const counters: Record<string, unknown> = {}
        for (const [file, c] of Object.entries(w.__coverage__)) counters[file] = { hash: c.hash, s: c.s, f: c.f, b: c.b }
        try {
          sessionStorage.setItem(KEY, JSON.stringify(counters))
        } catch {
          /* over quota or blocked: this document's counters are lost */
        }
      })
    })
    await use(context)
    for (const page of context.pages()) {
      const json = await page
        .evaluate(() => {
          // The open document, and whatever an unloaded one left for it that
          // it has not yet handed over.
          const w = window as unknown as { __coverage__?: unknown }
          let left: string | null = null
          try {
            left = sessionStorage.getItem('__featherbaseCoverage')
            sessionStorage.removeItem('__featherbaseCoverage')
          } catch {
            /* no storage */
          }
          return JSON.stringify({ doc: w.__coverage__ ?? null, left })
        })
        .catch(() => null) // a page mid-crash has nothing left to read
      if (!json) continue
      const { doc, left } = JSON.parse(json) as { doc: CoverageData | null; left: string | null }
      if (doc) addDocument(browserCoverage, doc)
      if (left) {
        const unplaced = addHandedOver(browserCoverage, JSON.parse(left) as Record<string, FileCounters>)
        if (Object.keys(unplaced).length) browserCoverage.pending.push(unplaced)
      }
    }
  },
})

interface AuthWorkerFixtures {
  /** Path to the storageState captured by signing in once per worker. */
  adminStorageState: string
}

export const test = coverageTest.extend<object, AuthWorkerFixtures>({
  // Sign in for real, once per worker, and keep the resulting browser storage.
  // Doing it through the UI rather than synthesising the localStorage entries
  // keeps the suite ignorant of *how* the app writes a session down — the
  // login form is exercised here exactly as a user exercises it.
  adminStorageState: [
    async ({ browser }, use, workerInfo) => {
      const file = path.join(
        workerInfo.project.outputDir,
        '.auth',
        `admin-${workerInfo.workerIndex}.json`,
      )
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL })
      const page = await context.newPage()
      await loginAs(page)
      await page.getByTestId('session-user').waitFor()
      await context.storageState({ path: file })
      await context.close()
      await use(file)
    },
    { scope: 'worker' },
  ],
  storageState: ({ adminStorageState }, use) => use(adminStorageState),
})

/**
 * DSL-backed `test` with no stored session, so the browser starts signed
 * out. Specs whose subject is the login surface, an identity other than
 * Administrator, or a page that must be reached with no session import this
 * as `test` and drive `loginAs()` / `signIn(session)` themselves.
 */
export const anonymousTest = coverageTest

// Composable step: sign in as Administrator. Structural typing so it works
// with whatever context type the adapter gives the Session.
export function signIn<
  S extends {
    visit(path: string): S
    fillIn(label: string, value: string): S
    clickButton(text: string): S
    assertHas(selector: string): S
  },
>(session: S): S {
  // The post-login landing path varies with home-recall state
  // (/admin/home/home, a recent Table, …) — assert the admin shell instead.
  return session
    .visit('/login')
    .fillIn('Email or username', ADMIN_USER)
    .fillIn('Password', ADMIN_PWD)
    .clickButton('Sign in')
    .assertHas('[data-testid="import-data-link"]')
}
