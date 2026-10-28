// The assign box on a row's form (spec: assignments-tags-and-rules, "Assign a
// row to someone"). It invites an email address (#512), so typing a
// colleague's address assigns the row to them, and the list of assignees
// reads as their name, never their internal id.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

test('typing a colleague\'s email assigns the row to them, and the list shows their name', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Ab Ticket',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  const row = (await admin.post('/api/save_row', { table: 'Ab Ticket', row: { title: 'assign me' } })) as { row_id: string }
  await sql`insert into person ${sql({ row_id: 'psn_abmeenaabmeenaabmeen', created_by: 'Administrator', updated_by: 'Administrator', email: 'meena-ab@example.com', full_name: 'Meena Raman', enabled: true })}`

  await renderApp(`/featherbase/admin/${encodeURIComponent('Ab Ticket')}/${row.row_id}`, admin)
  const panel = await screen.findByTestId('assignments-panel')
  await user.type(within(panel).getByTestId('assign-to'), 'meena-ab@example.com')
  await user.click(within(panel).getByTestId('assign-submit'))

  await waitFor(() => expect(within(panel).getByTestId('assignee')).toHaveTextContent('Meena Raman'))
  expect(within(panel).getByTestId('assign-to')).toHaveValue('')
})
