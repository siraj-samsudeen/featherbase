import { test, adminAuth } from './fixtures'

const DT = 'Dash E2E Task'
const DASH = 'Dash E2E Board'

// Known data: 3 Open, 2 Closed, 1 Pending → 6 total, 3 open.
const STATUSES = ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending']

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed\nPending', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  for (const stage of STATUSES)
    await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 't', stage } })

  await request.delete(`/api/table/Dashboard/${encodeURIComponent(DASH)}`, { headers })
  const dash = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Dashboard',
      row: {
        row_id: DASH,
        label: 'E2E Board',
        config: JSON.stringify({
          cards: [
            { label: 'All Tasks', table: DT },
            { label: 'Open Tasks', table: DT, filters: [['stage', '=', 'Open']] },
          ],
          charts: [{ label: 'By Status', table: DT, group_by: 'stage' }],
        }),
      },
    },
  })
  if (dash.status() !== 201) throw new Error(`dashboard: ${dash.status()} ${await dash.text()}`)
})

// UI-026: a dashboard shows a count card and a bar chart that match the data.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
test('UI-026: dashboard number cards and bar chart match the underlying data', async ({ session }) => {
  await session
    .visit(`/admin/dashboard/${encodeURIComponent(DASH)}`)
    .assertHas('[data-testid="dashboard-title"]')

  await session
    .within('[data-testid="card-value-All Tasks"]', (value) => value.assertExactText('6'))
    .within('[data-testid="card-value-Open Tasks"]', (value) => value.assertExactText('3'))
    .within('[data-testid="bar-value-Open"]', (value) => value.assertExactText('3'))
    .within('[data-testid="bar-value-Closed"]', (value) => value.assertExactText('2'))
    .within('[data-testid="bar-value-Pending"]', (value) => value.assertExactText('1'))
})
