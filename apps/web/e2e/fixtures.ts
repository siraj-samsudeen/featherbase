// The feather-testing DSL entry point for this suite (framework Part I §6:
// journeys compile to fluent chains). Import `test` from here, not from
// @playwright/test, when writing journey specs.
import { test as featherTest } from 'feather-testing-core/playwright'

export const test = featherTest
export { expect } from '@playwright/test'

export const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

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
