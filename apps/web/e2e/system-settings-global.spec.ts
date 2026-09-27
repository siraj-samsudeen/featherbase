import { test, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Set4 Item'

async function setSettings(request: APIRequestContext, row: Record<string, unknown>) {
  const headers = await adminAuth(request)
  const res = await request.post('/api/save_row', { headers, data: { table: 'System Settings', row } })
  if (res.status() !== 201) throw new Error(`save settings: ${res.status()}`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  // A Table with a Date and a Currency field, both shown in the list.
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'due', column_type: 'Date', in_list_view: true },
        { column_name: 'amount', column_type: 'Currency', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // A known row: 9 March 2026, amount 1234.5.
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: 'set4-doc', due: '2026-03-09', amount: 1234.5 },
  })
  // Start from a known global format.
  await setSettings(request, { date_format: 'dd-mm-yyyy', currency: 'USD', currency_precision: 2 })
})

test.afterAll(async ({ request }) => {
  // Restore defaults so the global single doesn't leak into other specs.
  await setSettings(request, { date_format: 'yyyy-mm-dd', currency: 'USD', currency_precision: 2 })
})

// SET-004: System Settings are applied globally to rendering — the date
// format and currency precision flow into list cells and form previews, and
// changing the setting re-renders without any per-Table code.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
test('SET-004: date format and currency precision render globally', async ({ session, request }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .within('[data-testid="cell-due"]', (cell) => cell.assertExactText('09-03-2026'))
    .within('[data-testid="cell-amount"]', (cell) => cell.assertExactText('$1,234.50'))
    .visit(`/admin/${encodeURIComponent(DT)}/set4-doc`)
    .assertHas('[data-testid="form-view"]')
    .within('[data-testid="preview-due"]', (preview) => preview.assertExactText('09-03-2026'))
    .within('[data-testid="preview-amount"]', (preview) => preview.assertExactText('$1,234.50'))

  await setSettings(request, { date_format: 'mm-dd-yyyy' })
  await session
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .within('[data-testid="cell-due"]', (cell) => cell.assertExactText('03-09-2026'))

  await setSettings(request, { currency_precision: 3 })
  await session
    .reload()
    .within('[data-testid="cell-amount"]', (cell) => cell.assertExactText('$1,234.500'))
})
