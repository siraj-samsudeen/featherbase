// The e2e suite's fixture seam — and, since #216, its single auth story.
//
// WHICH `test` A SPEC IMPORTS *IS* ITS AUTH STORY:
//
//   import { test } from './fixtures'
//       Already signed in as Administrator. The browser context starts from a
//       storageState captured once per worker, so the spec navigates straight
//       to `/admin/...` — no `/login` round trip, no local `login(page)`
//       helper. This is the right import for the ~70 specs whose subject is
//       something *behind* the login, not the login itself.
//
//   import { anonymousTest as test } from './fixtures'
//       Signed out. The spec drives `/login` itself with `loginAs()` below.
//       Correct when the login surface IS the subject (smoke, admin,
//       account-menu, i18n-login, oauth, palette, list-settings,
//       user-management), when the identity that matters is NOT Administrator
//       (home-recall, portal, assign, realtime), or when the page under test
//       must be reached with no session at all (web-page, web-form).
//
//   import { journeyTest as test } from './fixtures'
//       The feather-testing DSL (framework Part I §6: journeys compile to
//       fluent chains). These specs walk the sign-in as part of the journey —
//       `signIn(session)` below is a step of the story they tell — so they
//       deliberately do NOT reuse the stored session.
//
// The request-side setup every spec does (`POST /api/login` for a bearer
// token) collapses to the `adminAuth()` / `adminToken()` helpers here. They
// are helpers rather than a fixture on purpose: the majority of call sites are
// `test.beforeAll`, and a token fixture would have to be worker-scoped to be
// addressable there — while no single test calls it twice, so a fixture would
// save nothing and only add a second way to say the same thing.
import fs from 'node:fs'
import path from 'node:path'
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { test as featherTest } from 'feather-testing-core/playwright'

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

interface AuthWorkerFixtures {
  /** Path to the storageState captured by signing in once per worker. */
  adminStorageState: string
}

export const test = base.extend<object, AuthWorkerFixtures>({
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
 * Plain Playwright `test`: no stored session, so the browser starts signed
 * out. Specs whose subject is the login surface, an identity other than
 * Administrator, or a page that must be reached with no session import this
 * as `test` and drive `loginAs()` themselves.
 */
export const anonymousTest = base

/** The feather-testing DSL entry point. Journey specs import this as `test`. */
export const journeyTest = featherTest

// Framework §12 (the manual is a view): under SNAP=1, capture this moment
// into the manual's slot for the given step id. The document never changes;
// its assets mature — a slot's PNG overwrites the ASCII fallback's place.
// No-op on normal runs, so snapping can never make the suite flaky.
export async function snap(page: Page, slot: string): Promise<void> {
  if (!process.env.SNAP) return
  await page.screenshot({ path: `../../docs/manual/shots/${slot}.png` })
}

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
