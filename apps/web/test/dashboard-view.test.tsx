// UI-026: a Dashboard shows number cards and a bar chart that match the data.
// Moved down from e2e/dashboard.spec.ts (#1080): the page in jsdom, its counts
// from the real in-process server on the sandboxed database.
import { screen, waitFor } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const T = 'Dv Task'
const DASH = 'Dv Board'

test('UI-026: dashboard number cards and bar chart match the underlying data', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed\nPending', in_list_view: true },
    ],
  })
  // 3 Open, 2 Closed, 1 Pending: 6 in all, 3 open.
  for (const stage of ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending'])
    await admin.post('/api/save_row', { table: T, row: { title: 't', stage } })
  await admin.post('/api/save_row', {
    table: 'Dashboard',
    row: {
      row_id: DASH,
      label: 'Dv Board',
      config: JSON.stringify({
        cards: [
          { label: 'All Tasks', table: T },
          { label: 'Open Tasks', table: T, filters: [['stage', '=', 'Open']] },
        ],
        charts: [{ label: 'By Status', table: T, group_by: 'stage' }],
      }),
    },
  })

  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  await screen.findByTestId('dashboard-title', {}, { timeout: 8000 })
  const exact = (id: string, text: string) =>
    waitFor(() => expect(screen.getByTestId(id).textContent?.trim()).toBe(text), { timeout: 8000 })
  await exact('card-value-All Tasks', '6')
  await exact('card-value-Open Tasks', '3')
  await exact('bar-value-Open', '3')
  await exact('bar-value-Closed', '2')
  await exact('bar-value-Pending', '1')
})
