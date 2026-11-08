// WF-002 on the row form: someone with the transition's role clicks its
// button, the state moves, the button goes, and the trail names who took it.
// Moved from e2e/workflow.spec.ts (#1080); the server half of the trail is
// apps/server/test/workflow.test.ts.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Wfa Task'
const ENC = encodeURIComponent(DT)

test('WF-002: the Approve button moves the row to Approved and records who took it', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Wfa Approver' } })
  await admin.post('/api/save_row', {
    table: 'Workflow',
    row: {
      row_id: 'Wfa Flow',
      ref_table: DT,
      is_active: true,
      states: [
        { state: 'Draft', target_status: 'draft' },
        { state: 'Approved', target_status: 'submitted' },
      ],
      transitions: [{ state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'Wfa Approver' }],
    },
  })
  await admin.post(`/api/table/${ENC}`, { row_id: 'wfa-1', title: 'Approve me' })

  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/wfa-1`, admin)
  await waitFor(() => expect(screen.getByTestId('workflow-state')).toHaveTextContent(/^Draft$/))
  const actions = await screen.findByTestId('workflow-actions')
  await userEvent.click(await within(actions).findByRole('button', { name: 'Approve' }))

  await waitFor(() => expect(screen.getByTestId('workflow-state')).toHaveTextContent(/^Approved$/))
  await waitFor(() => expect(screen.queryByTestId('workflow-action-Approve')).not.toBeInTheDocument())
  const filters = encodeURIComponent(JSON.stringify([['ref_name', '=', 'wfa-1']]))
  const fields = encodeURIComponent(JSON.stringify(['action', 'to_state', 'actor']))
  const trail = await admin.get<{ data: { action: string; to_state: string; actor: string }[] }>(
    `/api/table/Workflow%20Action?filters=${filters}&fields=${fields}`,
  )
  expect(trail.data).toEqual([{ action: 'Approve', to_state: 'Approved', actor: 'Administrator' }])
})
