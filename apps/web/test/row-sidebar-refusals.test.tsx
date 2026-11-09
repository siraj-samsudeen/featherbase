// The row sidebar's panels (assignments, tags, attachments, comments) when the
// network drops, or when the
// server refuses what the person asked for. Gaps the merged web coverage
// report (ADR 0012) showed: no spec drives a refused sidebar action, so the
// message each panel shows on a refusal was never seen. Every refusal here is
// a real answer from the in-process server — a person who does not exist, a
// row deleted underneath the open form — never a stubbed response.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'Rsr Ticket'
const ENC = encodeURIComponent(DT)

type Admin = Parameters<typeof renderApp>[1]

async function seedRow(admin: Admin, property: string): Promise<string> {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { table_name: DT, property, value: 'true' },
  })
  const row = (await admin.post('/api/save_row', { table: DT, row: { title: 'refuse me' } })) as { row_id: string }
  return row.row_id
}

async function openRow(admin: Admin, rowId: string, tab = 'Collaboration') {
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(decodeURIComponent(ENC)))}/row/${rowId}`, admin)
  await screen.findByTestId('form-view')
  await userEvent.click(await screen.findByRole('tab', { name: tab }))
}

test('assigning to someone who is not a person says the server could not find them', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin, 'enable_assignments')
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
  const rowId = await seedRow(admin, 'enable_tags')
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('tags-panel')
  await waitFor(() => expect(panel).toHaveTextContent('No tags'))
  await user.type(within(panel).getByTestId('tag-input'), '   {Enter}')
  expect(within(panel).queryAllByTestId('tag-chip')).toHaveLength(0)
  expect(within(panel).queryByTestId('tag-error')).not.toBeInTheDocument()
  await user.clear(within(panel).getByTestId('tag-input'))
  await admin.delete(`/api/table/${ENC}/${rowId}`)
  // Enter adds, the same as the Add button.
  await user.type(within(panel).getByTestId('tag-input'), 'urgent{Enter}')
  expect(await within(panel).findByTestId('tag-error')).toHaveTextContent(/not found/i)
  expect(within(panel).queryAllByTestId('tag-chip')).toHaveLength(0)
})

test('+ Attach opens the file picker', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin, 'enable_files')
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
  const rowId = await seedRow(admin, 'enable_files')
  const file = (await admin.post('/api/save_row', {
    table: 'File',
    row: { file_name: 'gone.txt', ref_table: DT, ref_name: rowId },
  })) as { row_id: string }
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('attachments-panel')
  await within(panel).findByText('gone.txt')
  const remove = await within(panel).findByRole('button', { name: 'Remove gone.txt' })
  await admin.delete(`/api/table/File/${encodeURIComponent(file.row_id)}`)
  await user.click(remove)
  expect(await within(panel).findByTestId('attach-error')).toHaveTextContent(/not found/i)
})

test('a comment on a row deleted meanwhile is refused and the draft is kept', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin, 'enable_discussion')
  await openRow(admin, rowId, 'Activity')
  const panel = await screen.findByTestId('comments-panel')
  await waitFor(() => expect(screen.getByTestId('activity-timeline')).toHaveTextContent('Administrator created this'))
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
  await openRow(admin, 'rsr-1', 'Form')
  const actions = await screen.findByTestId('workflow-actions')
  await within(actions).findByRole('button', { name: 'Approve' })
  await admin.post(`/api/table/${ENC}/rsr-1:apply_workflow_action`, { action: 'Approve' })
  await user.click(within(actions).getByRole('button', { name: 'Approve' }))
  expect(await screen.findByText('Action "Approve" is not allowed from state "Approved"')).toBeInTheDocument()
})

/** Requests to an address starting with `prefix` are lost, as offline. */
function dropNetwork(prefix: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith(prefix)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('an assignment the network drops says the assignment failed', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin, 'enable_assignments')
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('assignments-panel')
  await user.type(within(panel).getByTestId('assign-to'), 'Administrator')
  dropNetwork('/api/assign')
  await user.click(within(panel).getByTestId('assign-submit'))
  expect(await within(panel).findByTestId('assign-error')).toHaveTextContent('Assign failed')
})

test('a tag the network drops says adding the tag failed', async ({ admin }) => {
  const user = userEvent.setup()
  const rowId = await seedRow(admin, 'enable_tags')
  await openRow(admin, rowId)
  const panel = await screen.findByTestId('tags-panel')
  await waitFor(() => expect(panel).toHaveTextContent('No tags'))
  dropNetwork('/api/tags')
  await user.type(within(panel).getByTestId('tag-input'), 'urgent{Enter}')
  expect(await within(panel).findByTestId('tag-error')).toHaveTextContent('Add tag failed')
})
