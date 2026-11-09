// access-tokens' fenced scenarios a person reads on screen (#1070): the rename
// dialog and the name the issue dialog suggests, rendered in jsdom against the
// real in-process server. The renames the server alone proves are in
// apps/server/test/scenarios/.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'access-tokens')
const WAIT = { timeout: 15_000 }

type Account = { row_id: string; label: string }
type Token = { id: string; revoked_at: string | null; expires_at: string | null }

const createAccount = (admin: TestClient, label: string) => admin.post<Account>('/api/service_accounts', { label, roles: [] })
const issue = (admin: TestClient, owner: string, label: string, expiresAt?: string) =>
  admin.post<Token>('/api/access_tokens', { owner, label, ...(expiresAt ? { expires_at: expiresAt } : {}) })

async function openTokens(admin: TestClient) {
  await renderApp('/featherbase/admin/access-tokens', admin)
  await screen.findByTestId('issue-token', {}, WAIT)
}

async function serviceAccountsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
}

async function prepareToken(user: ReturnType<typeof userEvent.setup>, account: Account) {
  await serviceAccountsTab(user)
  await user.click(await screen.findByTestId(`sa-issue-${account.row_id}`, {}, WAIT))
  await screen.findByTestId('issue-dialog')
}

const preparedName = () => (screen.getByTestId('token-label') as HTMLInputElement).value

describe('access-tokens', () => {
  scenario('Cancel leaves the name alone', async ({ admin }, step) => {
    const user = userEvent.setup()
    let account!: Account
    await step('the service account "warehouse-import-agent" exists', async () => {
      account = await createAccount(admin, 'warehouse-import-agent')
    })
    await step('a System Manager edits its name to "warehouse-reader" but cancels', async () => {
      await openTokens(admin)
      await serviceAccountsTab(user)
      await user.click(await screen.findByTestId(`sa-rename-${account.row_id}`, {}, WAIT))
      const name = screen.getByTestId('rename-name')
      await user.clear(name)
      await user.type(name, 'warehouse-reader')
      await user.click(within(screen.getByTestId('rename-dialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByTestId('rename-dialog')).toBeNull())
    })
    await step('the service account is still named "warehouse-import-agent"', async () => {
      const { service_accounts } = await admin.get<{ service_accounts: Account[] }>('/api/service_accounts')
      expect(service_accounts.find((a) => a.row_id === account.row_id)?.label).toBe('warehouse-import-agent')
      expect(screen.getByTestId(`sa-${account.row_id}`)).toHaveTextContent('warehouse-import-agent')
    })
  }, 40_000)

  scenario('Old tokens still count', async ({ admin }, step) => {
    const user = userEvent.setup()
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
      await openTokens(admin)
      await prepareToken(user, account)
    })
    await step('its suggested name is "warehouse-import-agent-3"', async () => {
      await waitFor(() => expect(preparedName()).toBe('warehouse-import-agent-3'), WAIT)
    })
  }, 40_000)

  scenario('A deliberate name survives changing owner', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user is preparing a token for "warehouse-import-agent"', async () => {
      const account = await createAccount(admin, 'warehouse-import-agent')
      await openTokens(admin)
      await prepareToken(user, account)
      await waitFor(() => expect(preparedName()).toBe('warehouse-import-agent-1'), WAIT)
    })
    await step('the user replaces the suggested name with "nightly export" and changes owner', async () => {
      const label = screen.getByTestId('token-label')
      await user.clear(label)
      await user.type(label, 'nightly export')
      const owner = screen.getByTestId('token-owner') as HTMLSelectElement
      const other = [...owner.options].find((o) => o.value !== owner.value)!.value
      await user.selectOptions(owner, other)
      expect(owner.value).toBe(other)
    })
    await step('the name remains "nightly export"', () => expect(preparedName()).toBe('nightly export'))
  }, 40_000)
})
