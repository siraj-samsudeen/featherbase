// #852: the Issue access token dialog says what the token will reach before it
// is issued, warns when its owner holds no role of its own, and asks before
// issuing a token that never expires.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

async function openIssue(admin: Parameters<typeof renderApp>[1]) {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/access-tokens', admin)
  await waitFor(() => expect(screen.getByTestId('issue-token')).toBeEnabled())
  await user.click(await screen.findByTestId('issue-token', {}, { timeout: 10_000 }))
  return user
}

test('#852 a new service account: the dialog lists what its token reaches and warns it has no role', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Reach Dock', columns: [{ column_name: 'code', column_type: 'Data' }] })
  const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'dock-importer' })
  const user = await openIssue(admin)

  // Administrator first: every Table, no warning.
  expect(await screen.findByTestId('token-reach', {}, { timeout: 10_000 })).toHaveTextContent('every Table')
  expect(screen.queryByTestId('token-reach-warning')).not.toBeInTheDocument()

  await user.selectOptions(screen.getByTestId('token-owner'), svc.row_id)
  await waitFor(() => expect(screen.getByTestId('token-reach')).toHaveTextContent('Can change: nothing'))
  expect(screen.getByTestId('token-reach')).toHaveTextContent('Can read: Glossary Term')
  expect(screen.getByTestId('token-reach')).not.toHaveTextContent('Reach Dock')
  expect(screen.getByTestId('token-reach-warning')).toHaveTextContent('dock-importer has no role of its own')

  // A role that grants nothing still leaves it at what every account can.
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Dock Nothing' } })
  await admin.post(`/api/service_accounts/${svc.row_id}/roles`, { roles: ['Dock Nothing'] })
  await user.click(within(screen.getByTestId('issue-dialog')).getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByTestId('issue-token'))
  await user.selectOptions(screen.getByTestId('token-owner'), svc.row_id)
  await waitFor(() => expect(screen.getByTestId('token-reach-warning')).toHaveTextContent("dock-importer's roles grant nothing beyond what every account can"))

  // Given a role, the account reaches its Table and the warning goes.
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Dock Writer' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Reach Dock', role: 'Dock Writer', can_read: true, can_write: true } })
  await admin.post(`/api/service_accounts/${svc.row_id}/roles`, { roles: ['Dock Writer'] })
  await user.click(within(screen.getByTestId('issue-dialog')).getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByTestId('issue-token'))
  await user.selectOptions(screen.getByTestId('token-owner'), svc.row_id)
  await waitFor(() => expect(screen.getByTestId('token-reach')).toHaveTextContent('Can change: Reach Dock'))
  expect(screen.queryByTestId('token-reach-warning')).not.toBeInTheDocument()
})

test('#852 a token that never expires asks first; one with an expiry does not', async ({ admin }) => {
  const user = await openIssue(admin)
  await user.clear(screen.getByTestId('token-label'))
  await user.type(screen.getByTestId('token-label'), 'forever token')
  await user.click(screen.getByTestId('issue-confirm'))
  expect(await screen.findByTestId('token-no-expiry')).toHaveTextContent('never expires')
  expect(screen.queryByTestId('secret-dialog')).not.toBeInTheDocument()
  const listed = async () => (await admin.get<{ tokens: { label: string }[] }>('/api/access_tokens')).tokens.map((t) => t.label)
  expect(await listed()).not.toContain('forever token')

  // Choosing an expiry drops the question and issues straight away.
  await user.selectOptions(screen.getByTestId('token-expiry'), '7 days')
  expect(screen.queryByTestId('token-no-expiry')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByTestId('token-expiry'), 'Never expires')
  await user.click(screen.getByTestId('issue-confirm'))
  await screen.findByTestId('token-no-expiry')
  await user.click(screen.getByTestId('issue-confirm'))
  await screen.findByTestId('secret-dialog')
  expect(await listed()).toContain('forever token')
})
