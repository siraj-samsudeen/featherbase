// Access Tokens: the token list says what the server will do with each token.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

test('each token shows whether it still works: active, revoked, expired or owner disabled', async ({ admin }) => {
  const live = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-states-live' })
  const off = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-states-off' })
  const issue = (label: string, owner: string) => admin.post<{ id: string }>('/api/access_tokens', { label, owner })
  const active = await issue('states active', live.row_id)
  const revoked = await issue('states revoked', live.row_id)
  const expired = await issue('states expired', live.row_id)
  const disabled = await issue('states disabled', off.row_id)
  await admin.delete(`/api/access_tokens/${revoked.id}`)
  await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${expired.id}`
  await admin.fetch(`/api/service_accounts/${off.row_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })

  await renderApp('/featherbase/admin/access-tokens', admin)
  const state = async (id: string) => (await screen.findByTestId(`token-state-${id}`, {}, { timeout: 10_000 })).textContent
  expect(await state(active.id)).toBe('active')
  expect(await state(revoked.id)).toBe('revoked')
  expect(await state(expired.id)).toBe('expired')
  expect(await state(disabled.id)).toBe('owner disabled')

  // A revoked token stays listed but cannot be revoked again; the others,
  // expired or not, can still be killed.
  expect(within(screen.getByTestId(`token-${revoked.id}`)).getByText('states revoked')).toBeInTheDocument()
  expect(screen.queryByTestId(`revoke-${revoked.id}`)).not.toBeInTheDocument()
  for (const id of [active.id, expired.id, disabled.id]) expect(screen.getByTestId(`revoke-${id}`)).toBeInTheDocument()
})

// The issue dialog end to end, and turning a service account off and on —
// the paths the merged web coverage report (ADR 0012) showed no test taking.
test('a token issued for a service account, with an expiry, is copied once and stored as chosen', async ({ admin }) => {
  const user = userEvent.setup() // also stands in for the clipboard
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-issue-dialog' })
  await renderApp('/featherbase/admin/access-tokens', admin)

  // Opened and dismissed three ways: Cancel, Escape, and a click outside.
  await user.click(await screen.findByTestId('issue-token', {}, { timeout: 10_000 }))
  await user.click(within(screen.getByTestId('issue-dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('issue-dialog')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('issue-token'))
  fireEvent.keyDown(screen.getByTestId('issue-dialog'), { key: 'Escape' })
  expect(screen.queryByTestId('issue-dialog')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('issue-token'))
  fireEvent.click(screen.getByTestId('issue-dialog').parentElement!)
  expect(screen.queryByTestId('issue-dialog')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('issue-token'))
  await user.type(screen.getByTestId('token-label'), 'nightly export')
  await user.selectOptions(await screen.findByTestId('token-owner'), svc.row_id)
  await user.selectOptions(screen.getByTestId('token-expiry'), '30 days')
  await user.click(screen.getByTestId('issue-confirm'))

  const secret = await screen.findByTestId('secret-dialog')
  expect(secret).toHaveTextContent('Token “nightly export” created')
  const value = within(secret).getByTestId('secret-value').textContent!
  await user.click(within(secret).getByTestId('copy-secret'))
  expect(within(secret).getByTestId('copy-secret')).toHaveTextContent('Copied ✓')
  expect(await navigator.clipboard.readText()).toBe(value)
  await user.click(within(secret).getByTestId('secret-done'))
  expect(screen.queryByTestId('secret-dialog')).not.toBeInTheDocument()

  const { tokens } = await admin.get<{ tokens: { label: string; owner: string; expires_at: string | null }[] }>('/api/access_tokens')
  const stored = tokens.find((t) => t.label === 'nightly export')!
  expect(stored.owner).toBe(svc.row_id)
  const days = (new Date(stored.expires_at!).getTime() - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(29)
  expect(days).toBeLessThanOrEqual(30)
})

test('a service account can be turned off and back on from its row', async ({ admin }) => {
  const user = userEvent.setup()
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-toggle' })
  await renderApp('/featherbase/admin/access-tokens', admin)
  const toggle = await screen.findByTestId(`sa-toggle-${svc.row_id}`, {}, { timeout: 10_000 })
  expect(toggle).toHaveTextContent('Disable')
  await user.click(toggle)
  await waitFor(() => expect(screen.getByTestId(`sa-toggle-${svc.row_id}`)).toHaveTextContent('Enable'))
  const enabled = async () =>
    (await admin.get<{ service_accounts: { row_id: string; enabled: boolean }[] }>('/api/service_accounts')).service_accounts.find(
      (a) => a.row_id === svc.row_id,
    )!.enabled
  expect(await enabled()).toBe(false)
  await user.click(screen.getByTestId(`sa-toggle-${svc.row_id}`))
  await waitFor(() => expect(screen.getByTestId(`sa-toggle-${svc.row_id}`)).toHaveTextContent('Disable'))
  expect(await enabled()).toBe(true)
})
