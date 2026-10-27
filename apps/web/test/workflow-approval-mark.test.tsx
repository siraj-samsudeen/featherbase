import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

test('a workflow state approval checkbox saves its boolean choice', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Approval Mark Task', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', {
    table: 'Workflow',
    row: { row_id: 'Approval Mark Flow', ref_table: 'Approval Mark Task', is_active: false,
      states: [{ state: 'Draft', target_status: 'draft' }], transitions: [] },
  })
  await renderApp('/featherbase/admin/Workflow/Approval%20Mark%20Flow', admin)
  const mark = await screen.findByRole('checkbox', { name: 'states, Waits for approval, row 1' })
  expect(mark).not.toBeChecked()
  const user = userEvent.setup()
  await user.click(mark)
  await user.click(screen.getByTestId('form-save'))
  const saved = () => admin.get<{ states: { waits_for_approval: boolean }[] }>('/api/table/Workflow/Approval%20Mark%20Flow')
  await waitFor(async () => expect((await saved()).states[0].waits_for_approval).toBe(true))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  await user.click(screen.getByRole('checkbox', { name: 'states, Waits for approval, row 1' }))
  await user.click(screen.getByTestId('form-save'))
  await waitFor(async () => expect((await saved()).states[0].waits_for_approval).toBe(false))
})
