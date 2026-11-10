// Access Tokens paths the merged web coverage report (ADR 0012) showed red: a
// person who is not a System Manager, owners with no name, a token's reach
// over many Tables, a revoke or a switch the network drops, an empty name
// submitted with Enter, Escape while a dialog is busy, and Tab from outside
// an open dialog.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { grantRole } from 'server/test/fixtures'
import { holdResponses } from './held-requests'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }

async function openPage(as: Client) {
  await renderApp('/featherbase/admin/access-tokens', as)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled(), T)
}

/** The network drops every request with this method whose address contains `part`. */
function dropNetwork(method: string, part: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return init?.method === method && url.includes(part) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}

/** A person who may use the Admin but is not a System Manager. */
async function deskUser(admin: Client, createUser: (o: { roles: string[] }) => Promise<Client>) {
  await admin.post('/api/table_def', { name: 'Atx Desk', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: 'Atx Desk', role: 'Atx Reader', can_read: true })
  return createUser({ roles: ['Atx Reader'] })
}

test('a person who is not a System Manager sees only their own tokens, with no owner column or tabs', async ({ admin, createUser }) => {
  const person = await deskUser(admin, createUser)
  const tok = await person.post<{ id: string }>('/api/access_tokens', { label: 'mine only' })
  await openPage(person)
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.getByTestId(`token-${tok.id}`)).toHaveTextContent('mine only')
  expect(screen.queryByTestId(`token-owner-${tok.id}`)).not.toBeInTheDocument()
})

test('a person with no name suggests their token label as My token', async ({ admin, createUser }) => {
  const person = await deskUser(admin, createUser)
  await sql`update person set full_name = null where row_id = ${person.user}`
  const user = userEvent.setup()
  await openPage(person)
  await user.click(screen.getByTestId('issue-token'))
  expect(screen.getByTestId('token-label')).toHaveValue('My token-1')
})

test("another person's token whose owner has no name, username or email reads Unnamed person", async ({ admin, createUser }) => {
  const person = await createUser({ roles: [] })
  const tok = await person.post<{ id: string }>('/api/access_tokens', { label: 'someone else' })
  // A person the database holds with no name, username or email.
  await sql`update person set full_name = null, username = null, email = null where row_id = ${person.user}`
  await openPage(admin)
  expect(screen.getByTestId(`token-owner-${tok.id}`)).toHaveTextContent('Unnamed person')
})

test("a token's reach names its first six Tables, marks own-rows ones, and counts the rest", async ({ admin }) => {
  const tables = Array.from({ length: 7 }, (_, i) => `Reach Bin ${i + 1}`)
  for (const name of tables) await admin.post('/api/table_def', { name, columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { table: tables, role: 'Reach Many', can_read: true, own_rows_only: true })
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'many-bins' })
  await admin.post(`/api/service_accounts/${svc.row_id}/roles`, { roles: ['Reach Many'] })
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(screen.getByTestId('issue-token'))
  await user.selectOptions(screen.getByTestId('token-owner'), svc.row_id)
  await waitFor(() => expect(screen.getByTestId('token-reach')).toHaveTextContent('Reach Bin 1 (own rows only), Reach Bin 2 (own rows only)'), T)
  expect(screen.getByTestId('token-reach')).toHaveTextContent(/Can read: .* and \d+ more/)
})

test('a revoke the network drops says it failed and leaves the token active', async ({ admin }) => {
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-revoke-dropped' })
  const tok = await admin.post<{ id: string }>('/api/access_tokens', { label: 'keep me', owner: svc.row_id })
  await openPage(admin)
  dropNetwork('DELETE', '/api/access_tokens/')
  await userEvent.click(screen.getByTestId(`revoke-${tok.id}`))
  expect(await screen.findByText('Failed to fetch', {}, T)).toBeInTheDocument()
  expect(screen.getByTestId(`token-state-${tok.id}`)).toHaveTextContent('active')
})

test('turning a service account off when the network drops says it failed and leaves it on', async ({ admin }) => {
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-toggle-dropped' })
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
  const toggle = await screen.findByTestId(`sa-toggle-${svc.row_id}`, {}, T)
  dropNetwork('PATCH', '/api/service_accounts/')
  await user.click(toggle)
  expect(await screen.findByText('Failed to fetch', {}, T)).toBeInTheDocument()
  expect(screen.getByTestId(`sa-toggle-${svc.row_id}`)).toHaveTextContent('Disable')
})

test('Enter on a new service account with no name creates nothing', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
  await user.click(await screen.findByTestId('sa-create-open', {}, T))
  await screen.findByTestId('sa-role-System Manager', {}, T)
  await user.click(screen.getByTestId('sa-name'))
  await user.keyboard('{Enter}')
  expect(screen.getByTestId('sa-dialog')).toBeInTheDocument()
  expect(screen.queryByTestId('sa-error')).not.toBeInTheDocument()
})

test('Enter on a rename emptied of its name keeps the old name', async ({ admin }) => {
  const user = userEvent.setup()
  const token = await admin.post<{ id: string }>('/api/access_tokens', { label: 'atx keep' })
  await openPage(admin)
  await user.click(screen.getByTestId(`token-rename-${token.id}`))
  await user.clear(screen.getByTestId('rename-name'))
  await user.keyboard('{Enter}')
  expect(screen.getByTestId('rename-dialog')).toBeInTheDocument()
  expect(screen.getByTestId(`token-${token.id}`)).toHaveTextContent('atx keep')
})

test('Escape while a new service account is being created leaves its dialog open', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(screen.getByRole('tab', { name: 'Service accounts' }))
  await user.click(await screen.findByTestId('sa-create-open', {}, T))
  await screen.findByTestId('sa-role-System Manager', {}, T)
  await user.type(screen.getByTestId('sa-name'), 'svc-atx-busy')
  const held = holdResponses('/api/service_accounts')
  await user.click(screen.getByTestId('sa-create'))
  await held.asked
  await user.keyboard('{Escape}')
  expect(screen.getByTestId('sa-dialog')).toBeInTheDocument()
  held.release()
  await waitFor(() => expect(screen.queryByTestId('sa-dialog')).not.toBeInTheDocument(), T)
})

test('Tab with the focus outside an open dialog brings it to the first control, Shift+Tab to the last', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(screen.getByTestId('issue-token'))
  const dialog = screen.getByTestId('issue-dialog')
  ;(document.activeElement as HTMLElement).blur()
  await user.tab()
  expect(screen.getByTestId('token-label')).toHaveFocus()
  ;(document.activeElement as HTMLElement).blur()
  await user.tab({ shift: true })
  expect(within(dialog).getByTestId('issue-confirm')).toHaveFocus()
})
