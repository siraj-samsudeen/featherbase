// Access Tokens: the token list says what the server will do with each token.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { PrincipalName } from '../src/lib/people'

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
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled())
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
  await user.clear(screen.getByTestId('token-label'))
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
  await user.click(await screen.findByRole('tab', { name: 'Service accounts' }, { timeout: 10_000 }))
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

test('suggestions count every selected-owner token from either issuance entry point', async ({ admin }) => {
  const user = userEvent.setup()
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'warehouse-import-agent' })
  const other = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'warehouse-reader' })
  const revoked = await admin.post<{ id: string }>('/api/access_tokens', { label: 'old', owner: account.row_id })
  const expired = await admin.post<{ id: string }>('/api/access_tokens', { label: 'stale', owner: account.row_id })
  await admin.delete(`/api/access_tokens/${revoked.id}`)
  await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${expired.id}`
  await admin.post('/api/access_tokens', { label: 'unrelated', owner: other.row_id })
  await renderApp('/featherbase/admin/access-tokens', admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled())
  await user.click(await screen.findByTestId('issue-token', {}, { timeout: 10_000 }))
  expect(screen.getByTestId('token-label')).toHaveValue('Administrator-1')
  await user.selectOptions(screen.getByTestId('token-owner'), account.row_id)
  expect(screen.getByTestId('token-label')).toHaveValue('warehouse-import-agent-3')
  await user.selectOptions(screen.getByTestId('token-owner'), other.row_id)
  expect(screen.getByTestId('token-label')).toHaveValue('warehouse-reader-2')
  await user.clear(screen.getByTestId('token-label'))
  await user.type(screen.getByTestId('token-label'), 'nightly export')
  await user.selectOptions(screen.getByTestId('token-owner'), account.row_id)
  expect(screen.getByTestId('token-label')).toHaveValue('nightly export')
  await user.clear(screen.getByTestId('token-label'))
  await user.selectOptions(screen.getByTestId('token-owner'), other.row_id)
  expect(screen.getByTestId('token-label')).toHaveValue('')
  expect(screen.getByTestId('issue-confirm')).toBeDisabled()
  await user.click(within(screen.getByTestId('issue-dialog')).getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
  await user.click(await screen.findByTestId(`sa-issue-${account.row_id}`))
  expect(screen.getByTestId('token-label')).toHaveValue('warehouse-import-agent-3')
  expect(screen.getByTestId('token-owner')).toHaveValue(account.row_id)
})

test('renaming uses a cancellable dialog with server refusal feedback', async ({ admin }) => {
  const user = userEvent.setup()
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-before-rename' })
  await admin.post('/api/service_accounts', { label: 'svc-name-taken' })
  const token = await admin.post<{ id: string }>('/api/access_tokens', { label: 'before rename', owner: account.row_id })
  const { queryClient } = await renderApp('/featherbase/admin/access-tokens', admin)
  render(<QueryClientProvider client={queryClient}><span data-testid="cached-account-name"><PrincipalName id={account.row_id} /></span></QueryClientProvider>)
  await waitFor(() => expect(screen.getByTestId('cached-account-name')).toHaveTextContent('svc-before-rename'))
  await user.click(await screen.findByTestId(`token-rename-${token.id}`, {}, { timeout: 10_000 }))
  expect(screen.getByTestId('rename-name')).toHaveValue('before rename')
  await user.clear(screen.getByTestId('rename-name'))
  expect(screen.getByTestId('rename-save')).toBeDisabled()
  await user.type(screen.getByTestId('rename-name'), 'after rename')
  await user.click(within(screen.getByTestId('rename-dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByTestId(`token-${token.id}`)).toHaveTextContent('before rename')
  await user.click(screen.getByTestId(`token-rename-${token.id}`))
  expect(screen.getByTestId('rename-name')).toHaveValue('before rename')
  await user.clear(screen.getByTestId('rename-name'))
  await user.type(screen.getByTestId('rename-name'), 'after rename')
  await user.click(screen.getByTestId('rename-save'))
  await waitFor(() => expect(screen.queryByTestId('rename-dialog')).not.toBeInTheDocument())
  expect(await screen.findByTestId(`token-${token.id}`)).toHaveTextContent('after rename')
  expect(screen.queryByTestId('secret-dialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
  await user.click(await screen.findByTestId(`sa-rename-${account.row_id}`))
  await user.clear(screen.getByTestId('rename-name'))
  await user.type(screen.getByTestId('rename-name'), 'svc-name-taken')
  await user.click(screen.getByTestId('rename-save'))
  expect(await screen.findByTestId('rename-error')).toHaveTextContent('already exists')
  expect(screen.getByTestId(`sa-${account.row_id}`)).toHaveTextContent('svc-before-rename')
  await user.clear(screen.getByTestId('rename-name'))
  await user.type(screen.getByTestId('rename-name'), 'svc-after-rename')
  await user.click(screen.getByTestId('rename-save'))
  await waitFor(() => expect(screen.queryByTestId('rename-dialog')).not.toBeInTheDocument())
  expect(await screen.findByTestId(`sa-${account.row_id}`)).toHaveTextContent('svc-after-rename')
  await waitFor(() => expect(screen.getByTestId('cached-account-name')).toHaveTextContent('svc-after-rename'))
  await user.click(screen.getByTestId(`sa-issue-${account.row_id}`))
  expect(screen.getByTestId('token-label')).toHaveValue('svc-after-rename-2')
  const listed = await admin.get<{ tokens: { id: string; label: string; owner_name: string }[] }>('/api/access_tokens')
  expect(listed.tokens.find((t) => t.id === token.id)).toMatchObject({ label: 'after rename', owner_name: 'svc-after-rename' })
})

// Moved from e2e/access-tokens.spec.ts (#131, #1080): the create form and the
// Revoke button, driven through the page rather than the API. That the
// secret then authenticates, and stops once revoked, is the server's
// access-tokens.test.ts.
test('a service account created with a role is listed under its name with that role', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/access-tokens', admin)
  await user.click(await screen.findByRole('tab', { name: 'Service accounts' }, { timeout: 10_000 }))
  await user.click(screen.getByTestId('sa-create-open'))
  await user.type(await screen.findByTestId('sa-name', {}, { timeout: 10_000 }), 'svc-created-here')
  await user.click(await screen.findByTestId('sa-role-System Manager', {}, { timeout: 10_000 }))
  await user.click(screen.getByTestId('sa-create'))

  let id = ''
  await waitFor(async () => {
    const list = await admin.get<{ service_accounts: { row_id: string; label: string; roles: string[] }[] }>('/api/service_accounts')
    const made = list.service_accounts.find((a) => a.label === 'svc-created-here')
    expect(made?.row_id).toMatch(/^svc_[a-z2-7]{20}$/)
    expect(made?.roles).toEqual(['System Manager'])
    id = made!.row_id
  })
  const row = await screen.findByTestId(`sa-${id}`, {}, { timeout: 10_000 })
  expect(row).toHaveTextContent('svc-created-here')
  expect(row).toHaveTextContent('System Manager')
})

test('Revoke on a token row marks it revoked', async ({ admin }) => {
  const user = userEvent.setup()
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-revoke-here' })
  const tok = await admin.post<{ id: string }>('/api/access_tokens', { label: 'revoke me', owner: svc.row_id })
  await renderApp('/featherbase/admin/access-tokens', admin)
  expect((await screen.findByTestId(`token-state-${tok.id}`, {}, { timeout: 10_000 })).textContent).toBe('active')
  await user.click(screen.getByTestId(`revoke-${tok.id}`))
  await waitFor(() => expect(screen.getByTestId(`token-state-${tok.id}`).textContent).toBe('revoked'))
  const { tokens } = await admin.get<{ tokens: { id: string; revoked_at: string | null }[] }>('/api/access_tokens')
  expect(tokens.find((t) => t.id === tok.id)?.revoked_at).toEqual(expect.any(String))
})

test('a token that has been used says when it was last used', async ({ admin }) => {
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-used' })
  const tok = await admin.post<{ id: string }>('/api/access_tokens', { label: 'used once', owner: svc.row_id })
  await sql`update access_token set last_used_at = '2026-03-04T05:30:00Z' where id = ${tok.id}`
  await renderApp('/featherbase/admin/access-tokens', admin)
  const row = await screen.findByTestId(`token-${tok.id}`, {}, { timeout: 10_000 })
  expect(row).toHaveTextContent('04-Mar-2026 11:00 IST')
})
