import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { test, expect } from './pg-test'
import { app } from '../src/index'
import { config } from '../src/config'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { login } from '../src/auth'
import { provisionExternalUser, issueIdentityInvitation } from '../src/login-operations'
import { issuer } from './oidc-issuer'

// Build the real SPA first: pnpm --filter web build. Uses a test-only issuer,
// genuine HTTP, signed tokens and the real browser; no request interception.
const prove = process.env.AUTH_BROWSER_PROOF === '1' ? test : test.skip

// @spec identity_linking_requires_two_bound_proofs.one_person_uses_three_google_identities_for_the_same_tasker_work
// @spec identity_unlink_and_recovery_preserve_account_control
prove('browser enrollment, three linked Google identities, collision and missing-freshness refusal', async () => {
  expect(existsSync(resolve('../web/dist/index.html'))).toBe(true)
  const upstream = await issuer('google', true)
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.on('listening', resolve))
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`
  const priorOrigin = config.siteUrl
  config.siteUrl = origin
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  async function proveIdentity(page: Page, subject: string, freshness = 'fresh') {
    await page.getByLabel('Fixture identity').selectOption(subject)
    await page.getByLabel('Authentication evidence').selectOption(freshness)
    await page.getByRole('button', { name: 'Prove selected identity' }).click()
  }
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('browser-google', 'google', 'https://accounts.google.com', 'test-client', true)`
    const manager = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    const userId = await provisionExternalUser(`Bearer ${manager.token}`, 'Example Consultant')
    const invitation = await issueIdentityInvitation(`Bearer ${manager.token}`, userId, 'browser-google', 'enroll')
    await saveDoc('User', { row_id: 'other-browser-person', full_name: 'Other Person' })
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('occupied-browser-identity', 'other-browser-person', 'browser-google', 'https://accounts.google.com', 'occupied-subject')`
    await page.goto(`${origin}/featherbase/login`)
    await page.getByRole('button', { name: 'Use an enrollment or recovery code' }).click()
    await page.getByLabel('Administrator-issued code').fill(invitation)
    const enrollment = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/invitation')
    await page.getByRole('button', { name: 'Continue to provider' }).click()
    const enrollmentResponse = await enrollment
    if (!enrollmentResponse.ok()) expect(await enrollmentResponse.json()).not.toHaveProperty('error')
    await proveIdentity(page, 'personal-subject')
    await page.waitForFunction(() => Boolean(localStorage.getItem('fc_token')))
    await page.goto(`${origin}/featherbase/account`)
    await page.getByRole('button', { name: 'Unlink', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'last method' }).waitFor()
    for (const [subject, freshness] of [['workspace-one', 'fresh'], ['workspace-two', 'missing']]) {
      await page.getByRole('button', { name: 'Link another Google identity' }).click()
      await proveIdentity(page, subject, freshness)
      await page.waitForURL(`${origin}/featherbase/account`)
      await page.getByText(subject, { exact: false }).first().waitFor()
    }
    expect(await page.getByRole('button', { name: 'Unlink', exact: true }).count()).toBe(3)
    expect(await page.getByRole('button', { name: 'Link another Google identity' }).isDisabled()).toBe(true)
    expect(await page.getByText('Recent authentication is required.', { exact: false }).isVisible()).toBe(true)
    const who = await page.evaluate(async () => (await fetch('/api/whoami')).json())
    expect(who.row_id).toBe(userId)
    if (process.env.AUTH_BROWSER_ARTIFACT_DIR) {
      mkdirSync(process.env.AUTH_BROWSER_ARTIFACT_DIR, { recursive: true })
      await page.screenshot({ path: resolve(process.env.AUTH_BROWSER_ARTIFACT_DIR, 'auth-three-google-identities.png'), fullPage: true })
    }
    await page.getByRole('button', { name: 'Check authentication with this identity' }).first().click()
    await proveIdentity(page, 'personal-subject')
    await page.waitForURL(`${origin}/featherbase/account`)
    await page.getByRole('button', { name: 'Link another Google identity' }).click()
    const collision = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/callback')
    await proveIdentity(page, 'occupied-subject')
    expect((await collision).status()).toBe(409)
    expect((await sql`select user_id from external_identity where id = 'occupied-browser-identity'`)[0].user_id).toBe('other-browser-person')
    expect((await sql`select count(*)::int as count from external_identity where user_id = ${userId}`)[0].count).toBe(3)
  } finally {
    await browser.close()
    config.siteUrl = priorOrigin
    if ('closeAllConnections' in server) server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await upstream.close()
  }
}, 60_000)
