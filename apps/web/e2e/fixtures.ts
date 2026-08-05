// The feather-testing DSL entry point for this suite (framework Part I §6:
// journeys compile to fluent chains). Import `test` from here, not from
// @playwright/test, when writing journey specs.
import { test as featherTest } from 'feather-testing-core/playwright'

export const test = featherTest
export { expect } from '@playwright/test'

export const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// Framework §12 (the manual is a view): under SNAP=1, capture this moment
// into the manual's slot for the given step id. The document never changes;
// its assets mature — a slot's PNG overwrites the ASCII fallback's place.
// No-op on normal runs, so snapping can never make the suite flaky.
import type { Page } from '@playwright/test'
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
    .fillIn('Email or username', 'Administrator')
    .fillIn('Password', ADMIN_PWD)
    .clickButton('Sign in')
    .assertHas('[data-testid="import-data-link"]')
}
