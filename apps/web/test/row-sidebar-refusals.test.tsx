// The row sidebar's panels (assignments, tags, attachments, comments) when the
// server refuses what the person asked for. Gaps the merged web coverage
// report (ADR 0012) showed: no spec drives a refused sidebar action, so the
// message each panel shows on a refusal was never seen. Every refusal here is
// a real answer from the in-process server — a person who does not exist, a
// row deleted underneath the open form — never a stubbed response.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Rsr Ticket'
const ENC = encodeURIComponent(DT)

type Admin = Parameters<typeof renderApp>[1]

async function seedRow(admin: Admin): Promise<string> {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  const row = (await admin.post('/api/save_row', { table: DT, row: { title: 'refuse me' } })) as { row_id: string }
  return row.row_id
}

async function openRow(admin: Admin, rowId: string) {
  await renderApp(`/featherbase/admin/${ENC}/${rowId}`, admin)
  await screen.findByTestId('form-view')
}

test('assigning to someone who is not a person says the server could not find them', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('assignments-panel')
  await user.type(within(panel).getByTestId('assign-to'), 'nobody-rsr@example.com')
  await user.click(within(panel).getByTestId('assign-submit'))
  expect(await within(panel).findByText('Person nobody-rsr@example.com not found')).toBeInTheDocument()
  const todos = (await admin.get(
    `/api/table/ToDo?filters=${encodeURIComponent(JSON.stringify([['reference_name', '=', rowId]]))}`,
  )) as { data: unknown[] }
  expect(todos.data).toHaveLength(0)
})

test('a tag typed and entered on a row deleted meanwhile is refused, and nothing is stored', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('tags-panel')
  await waitFor(() => expect(panel).toHaveTextContent('No tags'))
  await admin.delete(`/api/table/${ENC}/${rowId}`)
  // Enter adds, the same as the Add button.
  await user.type(within(panel).getByTestId('tag-input'), 'urgent{Enter}')
  expect(await within(panel).findByTestId('tag-error')).toHaveTextContent(/not found/i)
  expect(within(panel).queryAllByTestId('tag-chip')).toHaveLength(0)
})

test('+ Attach opens the file picker', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('attachments-panel')
  const picker = within(panel).getByTestId('attach-file-input')
  let opened = 0
  picker.addEventListener('click', () => opened++)
  await user.click(within(panel).getByTestId('attach-file'))
  expect(opened).toBe(1)
})

test('removing an attachment someone else already removed says so', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin)
  const file = (await admin.post('/api/save_row', {
    table: 'File',
    row: { file_name: 'gone.txt', ref_table: DT, ref_name: rowId },
  })) as { row_id: string }
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('attachments-panel')
  await within(panel).findByText('gone.txt')
  await admin.delete(`/api/table/File/${encodeURIComponent(file.row_id)}`)
  await user.click(within(panel).getByRole('button', { name: 'Remove gone.txt' }))
  expect(await within(panel).findByTestId('attach-error')).toHaveTextContent(/not found/i)
})

test('a comment on a row deleted meanwhile is refused and the draft is kept', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin)
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('comments-panel')
  await waitFor(() => expect(panel).toHaveTextContent('No comments yet'))
  await admin.delete(`/api/table/${ENC}/${rowId}`)
  await user.type(within(panel).getByTestId('comment-input'), 'still there?')
  await user.click(within(panel).getByTestId('comment-submit'))
  expect(await within(panel).findByText(/not found/i)).toBeInTheDocument()
  expect(within(panel).getByTestId('comment-input')).toHaveValue('still there?')
})

test('a workflow action someone else already took is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Rsr Approver' } })
  await admin.post('/api/save_row', {
    table: 'Workflow',
    row: {
      row_id: 'Rsr Flow',
      ref_table: DT,
      is_active: true,
      states: [
        { state: 'Draft', target_status: 'draft' },
        { state: 'Approved', target_status: 'submitted' },
      ],
      transitions: [{ state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'Rsr Approver' }],
    },
  })
  await admin.post(`/api/table/${ENC}`, { row_id: 'rsr-1', title: 'approve me' })
  await openRow(admin, 'rsr-1')
  const actions = await screen.findByTestId('workflow-actions')
  await within(actions).findByRole('button', { name: 'Approve' })
  await admin.post(`/api/table/${ENC}/rsr-1:apply_workflow_action`, { action: 'Approve' })
  await user.click(within(actions).getByRole('button', { name: 'Approve' }))
  expect(await screen.findByText('Action "Approve" is not allowed from state "Approved"')).toBeInTheDocument()
})
