// access-tokens' fenced scenarios a person reads on screen (#1070): the rename
// dialog and the name the issue dialog suggests, rendered in jsdom against the
// real in-process server. The renames the server alone proves are in
// apps/server/test/scenarios/.
import { screen } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, byTestId, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'access-tokens')
const WAIT = { timeout: 15_000 }

type Account = { row_id: string; label: string }
type Token = { id: string; revoked_at: string | null; expires_at: string | null }

const createAccount = (admin: TestClient, label: string) => admin.post<Account>('/api/service_accounts', { label, roles: [] })
const issue = (admin: TestClient, owner: string, label: string, expiresAt?: string) =>
  admin.post<Token>('/api/access_tokens', { owner, label, ...(expiresAt ? { expires_at: expiresAt } : {}) })

async function openTokens(admin: TestClient): Promise<{ session: Session }> {
  const { session } = await renderSession('/featherbase/admin/access-tokens', admin, { session: WAIT })
  await session.assertText('Issue token')
  return { session }
}

/** The service account's row on the Service accounts tab. */
const accountRow = (session: Session, account: Account, fn: Parameters<Session['within']>[1]) =>
  session.clickButton('Service accounts').within(byTestId(`sa-${account.row_id}`), fn)

const prepareToken = (session: Session, account: Account) =>
  accountRow(session, account, (row) => row.clickButton('Issue token'))
    .until('the issue dialog is open', () => screen.queryByTestId('issue-dialog'))

describe('access-tokens', () => {
  scenario('Cancel leaves the name alone', async ({ admin }, step) => {
    let session!: Session
    let account!: Account
    await step('the service account "warehouse-import-agent" exists', async () => {
      account = await createAccount(admin, 'warehouse-import-agent')
    })
    await step('a System Manager edits its name to "warehouse-reader" but cancels', async () => {
      ;({ session } = await openTokens(admin))
      await accountRow(session, account, (row) => row.clickButton('Rename'))
        .fillIn('Name', 'warehouse-reader')
        .within('[data-testid="rename-dialog"]', (dialog) => dialog.clickButton('Cancel'))
        .until('the rename dialog has closed', () => !screen.queryByTestId('rename-dialog'))
    })
    await step('the service account is still named "warehouse-import-agent"', async () => {
      const { service_accounts } = await admin.get<{ service_accounts: Account[] }>('/api/service_accounts')
      expect(service_accounts.find((a) => a.row_id === account.row_id)?.label).toBe('warehouse-import-agent')
      await session.within(`[data-testid="sa-${account.row_id}"]`, (row) => row.assertText('warehouse-import-agent'))
    })
  }, 40_000)

  scenario('Old tokens still count', async ({ admin }, step) => {
    let session!: Session
    let account!: Account
    await step('the service account "warehouse-import-agent" owns one revoked token and one expired token', async () => {
      account = await createAccount(admin, 'warehouse-import-agent')
      const revoked = await issue(admin, account.row_id, 'acceptance revoked')
      await admin.delete(`/api/access_tokens/${revoked.id}`)
      // Let the server-issued credential really expire: no clock mocks, no DB writes.
      const expiresAt = Date.now() + 1500
      const expired = await issue(admin, account.row_id, 'acceptance expired', new Date(expiresAt).toISOString())
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 100)))
      const { tokens } = await admin.get<{ tokens: Token[] }>('/api/access_tokens')
      expect(tokens.find((t) => t.id === revoked.id)!.revoked_at).toBeTruthy()
      expect(new Date(tokens.find((t) => t.id === expired.id)!.expires_at!).getTime()).toBeLessThan(Date.now())
    })
    await step('the user prepares another token for "warehouse-import-agent"', async () => {
      ;({ session } = await openTokens(admin))
      await prepareToken(session, account)
    })
    await step('its suggested name is "warehouse-import-agent-3"', () => session.assertValue('Label', 'warehouse-import-agent-3'))
  }, 40_000)

  scenario('A deliberate name survives changing owner', async ({ admin }, step) => {
    let session!: Session
    await step('the user is preparing a token for "warehouse-import-agent"', async () => {
      const account = await createAccount(admin, 'warehouse-import-agent')
      ;({ session } = await openTokens(admin))
      await prepareToken(session, account).assertValue('Label', 'warehouse-import-agent-1')
    })
    await step('the user replaces the suggested name with "nightly export" and changes owner', async () => {
      await session.fillIn('Label', 'nightly export')
      // Any other owner, by value: which one is offered first is not the scenario's.
      const owner = screen.getByTestId('token-owner') as HTMLSelectElement
      const other = [...owner.options].find((o) => o.value !== owner.value)!
      await session.selectOption('Owner', other.textContent!.trim())
      expect(owner.value).toBe(other.value)
    })
    await step('the name remains "nightly export"', () => session.assertValue('Label', 'nightly export'))
  }, 40_000)
})
