// Access Tokens: the token list says what the server will do with each token.
import { screen, within } from '@testing-library/react'
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
