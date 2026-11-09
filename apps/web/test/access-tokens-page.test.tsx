// The Access Tokens page as a keyboard user and a person on a failing server
// meet it: its two tabs, its dialogs, and each list's Try again. A failure is
// real: inside the test's transaction a table the list reads is renamed away,
// then put back before Try again.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }
const tab = (name: string) => screen.getByRole('tab', { name })

async function openPage(admin: Admin) {
  await renderApp('/featherbase/admin/access-tokens', admin)
  await screen.findByRole('tab', { name: 'Tokens' }, T)
}

/**
 * The person comes back to the page (it becomes visible again, so its lists
 * reload) while `table` is gone, and the reload fails for real. `failed` waits
 * for what the page then shows; the table is put back afterwards, as a
 * repaired server would have it.
 */
async function returnWhileGone(table: string, failed: () => Promise<unknown>) {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await settleSandboxRequests()
  // The failing read aborts the test's transaction; rolling back to here
  // both repairs it and puts the table back.
  await sql.unsafe('savepoint table_gone')
  await sql.unsafe(`alter table featherbase.${table} rename to ${table}_gone`)
  act(() => { window.dispatchEvent(new Event('visibilitychange')) })
  await failed()
  await settleSandboxRequests()
  await sql.unsafe('rollback to savepoint table_gone')
}

test('the right arrow on the Tokens tab moves to Service accounts', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  tab('Tokens').focus()
  await user.keyboard('{ArrowRight}')
  expect(tab('Service accounts')).toHaveFocus()
  expect(tab('Service accounts')).toHaveAttribute('aria-selected', 'true')
})

test('the left arrow on Service accounts moves back to Tokens', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(tab('Service accounts'))
  await user.keyboard('{ArrowLeft}')
  expect(tab('Tokens')).toHaveFocus()
})

test('End moves to the last tab and Home to the first', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  tab('Tokens').focus()
  await user.keyboard('{End}')
  expect(tab('Service accounts')).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Home}')
  expect(tab('Tokens')).toHaveAttribute('aria-selected', 'true')
})

test('a key the tabs do not use leaves the tab chosen', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  tab('Tokens').focus()
  await user.keyboard('a')
  expect(tab('Tokens')).toHaveAttribute('aria-selected', 'true')
})

test('a token list that could not be loaded loads on Try again', async ({ admin }) => {
  await openPage(admin)
  const rows = screen.getByTestId('token-rows')
  await within(rows).findByText('No tokens yet', {}, T)
  await returnWhileGone('access_token', () => within(rows).findByRole('button', { name: 'Try again' }, T))
  await userEvent.click(within(rows).getByRole('button', { name: 'Try again' }))
  expect(await within(rows).findByText('No tokens yet', {}, T)).toBeInTheDocument()
})
test('service accounts that could not be loaded are reported on the Tokens tab, and Try again loads them', async ({ admin }) => {
  await openPage(admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled(), T)
  const outsideRows = () => screen.queryAllByRole('button', { name: 'Try again' }).filter((b) => !screen.getByTestId('token-rows').contains(b))
  await returnWhileGone('service_account', () => waitFor(() => expect(outsideRows()).toHaveLength(1), T))
  await userEvent.click(outsideRows()[0])
  await waitFor(() => expect(outsideRows()).toEqual([]), T)
})
test('a service account list that could not be loaded loads on Try again', async ({ admin }) => {
  await openPage(admin)
  await userEvent.click(tab('Service accounts'))
  const rows = screen.getByTestId('sa-rows')
  await within(rows).findByText('No service accounts yet', {}, T)
  await returnWhileGone('service_account', () => within(rows).findByRole('button', { name: 'Try again' }, T))
  await userEvent.click(within(rows).getByRole('button', { name: 'Try again' }))
  expect(await within(rows).findByText('No service accounts yet', {}, T)).toBeInTheDocument()
})
test('tokens that could not be loaded are reported on the Service accounts tab, and Try again loads them', async ({ admin }) => {
  await openPage(admin)
  await userEvent.click(tab('Service accounts'))
  await within(screen.getByTestId('sa-rows')).findByText('No service accounts yet', {}, T)
  const outsideRows = () => within(screen.getByTestId('service-accounts')).queryAllByRole('button', { name: 'Try again' })
    .filter((b) => !screen.getByTestId('sa-rows').contains(b))
  await returnWhileGone('access_token', () => waitFor(() => expect(outsideRows()).toHaveLength(1), T))
  await userEvent.click(outsideRows()[0])
  await waitFor(() => expect(outsideRows()).toEqual([]), T)
})
test('roles that could not be loaded for a new service account load on Try again', async ({ admin }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Atp Exporter' } })
  await openPage(admin)
  await userEvent.click(tab('Service accounts'))
  await within(screen.getByTestId('sa-rows')).findByText('No service accounts yet', {}, T)
  await settleSandboxRequests()
  await sql.unsafe('savepoint role_gone')
  await sql.unsafe('alter table featherbase.role rename to role_gone')
  await userEvent.click(screen.getByTestId('sa-create-open'))
  const dialog = screen.getByTestId('sa-dialog')
  const retry = await within(dialog).findByRole('button', { name: 'Try again' }, T)
  await settleSandboxRequests()
  await sql.unsafe('rollback to savepoint role_gone')
  await userEvent.click(retry)
  expect(await within(dialog).findByTestId('sa-role-Atp Exporter', {}, T)).toBeInTheDocument()
})
test('Cancel closes the new service account dialog without creating one', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(tab('Service accounts'))
  await user.click(await screen.findByTestId('sa-create-open', {}, T))
  await user.type(screen.getByTestId('sa-name'), 'svc-atp-unsaved')
  await user.click(within(screen.getByTestId('sa-dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('sa-dialog')).not.toBeInTheDocument()
  const { service_accounts } = await admin.get<{ service_accounts: { label: string }[] }>('/api/service_accounts')
  expect(service_accounts.map((a) => a.label)).not.toContain('svc-atp-unsaved')
})

test('Escape closes the new service account dialog', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await user.click(tab('Service accounts'))
  await user.click(await screen.findByTestId('sa-create-open', {}, T))
  await user.keyboard('{Escape}')
  expect(screen.queryByTestId('sa-dialog')).not.toBeInTheDocument()
})

test('Escape closes the rename dialog, leaving the name', async ({ admin }) => {
  const user = userEvent.setup()
  const token = await admin.post<{ id: string }>('/api/access_tokens', { label: 'atp keep' })
  await openPage(admin)
  await user.click(await screen.findByTestId(`token-rename-${token.id}`, {}, T))
  await user.keyboard('{Escape}')
  expect(screen.queryByTestId('rename-dialog')).not.toBeInTheDocument()
  expect(screen.getByTestId(`token-${token.id}`)).toHaveTextContent('atp keep')
})

async function issueToken(user: ReturnType<typeof userEvent.setup>, admin: Admin) {
  await openPage(admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled(), T)
  await user.click(screen.getByTestId('issue-token'))
  await user.clear(screen.getByTestId('token-label'))
  await user.type(screen.getByTestId('token-label'), 'atp secret')
  await user.selectOptions(screen.getByTestId('token-expiry'), '30')
  await user.click(screen.getByTestId('issue-confirm'))
  return screen.findByTestId('secret-dialog', {}, T)
}

test('Escape closes the dialog that shows a new secret', async ({ admin }) => {
  const user = userEvent.setup()
  await issueToken(user, admin)
  await user.keyboard('{Escape}')
  expect(screen.queryByTestId('secret-dialog')).not.toBeInTheDocument()
})

test('a secret the browser refuses to copy is to be selected and copied by hand', async ({ admin }) => {
  const user = userEvent.setup()
  const dialog = await issueToken(user, admin)
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
  await user.click(within(dialog).getByTestId('copy-secret'))
  expect(await within(dialog).findByText('Could not copy. Select and copy the secret above before closing.')).toBeInTheDocument()
  expect(within(dialog).getByTestId('copy-secret')).toHaveTextContent('Copy')
})

test('Tab from the last control of a dialog wraps to its first', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled(), T)
  await user.click(screen.getByTestId('issue-token'))
  screen.getByTestId('issue-confirm').focus()
  await user.tab()
  expect(screen.getByTestId('token-label')).toHaveFocus()
})

test('Shift+Tab from the first control of a dialog wraps to its last', async ({ admin }) => {
  const user = userEvent.setup()
  await openPage(admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled(), T)
  await user.click(screen.getByTestId('issue-token'))
  expect(screen.getByTestId('token-label')).toHaveFocus()
  await user.tab({ shift: true })
  expect(screen.getByTestId('issue-confirm')).toHaveFocus()
})
