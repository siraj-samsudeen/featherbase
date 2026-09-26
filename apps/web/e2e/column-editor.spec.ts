import { test, expect, adminToken, type APIRequestContext } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #209 (issue #197): "after importing I want to add a certain column but
// today it is not possible", and "in one of the things floor was spelled
// with a G, Glor".
//
// The Table Builder only ever built NEW Tables. A Table with rows in it had
// no way to grow a column, and a misspelled column name had no way back —
// the PUT route matches columns by name, so a changed name reads as
// delete-plus-add and orphans the rows.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).

const DT = 'Column Editor Zones'

async function seed(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` }
  await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'glor', label: 'Glor', column_type: 'Data', in_list_view: true },
        { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  for (const [glor, pop] of [
    ['Ground', 12],
    ['Mezzanine', 7],
  ] as const) {
    await request.post('/api/save_row', { headers, data: { table: DT, row: { glor, pop } } })
  }
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  await deleteTableIfExists(request, token, DT)
  await seed(request, token)
})

test.afterEach(async ({ request }) => {
  const token = await adminToken(request)
  await deleteTableIfExists(request, token, DT)
})

test('a misspelled column is renamed, and its rows come with it', async ({ session, request }) => {
  const token = await adminToken(request)
  await session
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .clickLink('Columns')
    .assertHas('[data-testid="column-editor"]')
    .assertHas('[data-testid="ce-row-glor"]')
    .within('[data-testid="ce-row-glor"]', (row) =>
      row
        .clickButton('Rename glor')
        .fillIn('New name for glor', 'floor')
        .clickButton('Rename'),
    )
    .assertHas('[data-testid="ce-row-floor"]')
    .refuteHas('[data-testid="ce-row-glor"]')

  // The whole point: the values were already right.
  const rows = await request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["floor","pop"]')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  expect(data.map((r) => r.floor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a rename that collides is refused, in place, with the reason', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/columns`)

  await session
    .within('[data-testid="ce-row-glor"]', (row) =>
      row
        .clickButton('Rename glor')
        .fillIn('New name for glor', 'pop')
        .clickButton('Rename'),
    )
    .assertHas('[data-testid="ce-rename-error-glor"]', { text: 'already has' })
    // And nothing moved.
    .assertHas('[data-testid="ce-row-glor"]')
    .assertHas('[data-testid="ce-row-pop"]')
})

test('a column is added to a Table that already has rows', async ({ session, request }) => {
  const token = await adminToken(request)
  await session.visit(`/admin/${encodeURIComponent(DT)}/columns`)

  await session
    .fillIn('Label', 'Aisle Code')
    .assertValue('Column name', 'aisle_code')
    .clickButton('Add column')
    .assertHas('[data-testid="ce-saved"]', { text: 'Added aisle_code' })
    .assertHas('[data-testid="ce-row-aisle_code"]')

  // Empty on the rows that were already there, and the old values are intact.
  const rows = await request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      '["glor","aisle_code"]',
    )}&limit_page_length=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  expect(data).toHaveLength(2)
  expect(data.every((r) => r.aisle_code === null || r.aisle_code === undefined)).toBe(true)
  expect(data.map((r) => r.glor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a name the server would reject is caught before the round trip', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/columns`)

  await session
    .fillIn('Label', 'Glor')
    .assertHas('[data-testid="ce-add-problem"]', { text: 'already has glor' })
    .within('[data-testid="ce-add-go"]', (button) => button.assertAttribute('disabled'))
    .fillIn('Column name', 'created_at')
    .assertHas('[data-testid="ce-add-problem"]', { text: 'standard column' })
    .within('[data-testid="ce-add-go"]', (button) => button.assertAttribute('disabled'))
    .fillIn('Column name', 'Not Snake')
    .assertHas('[data-testid="ce-add-problem"]', { text: 'snake_case' })
    .fillIn('Column name', 'aisle')
    .within('[data-testid="ce-add-go"]', (button) => button.refuteAttribute('disabled'))
})

test('a label is changed without touching the column or its data', async ({ session, request }) => {
  const token = await adminToken(request)
  await session.visit(`/admin/${encodeURIComponent(DT)}/columns`)

  await session
    .within('[data-testid="ce-row-glor"]', (row) =>
      row.fillIn('Label for glor', 'Floor').clickButton('Save'),
    )
    .assertHas('[data-testid="ce-saved"]', { text: 'glor' })
    .assertValue('Label for glor', 'Floor')

  // The machine name — and therefore every row — is untouched.
  const meta = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const def = (await meta.json()) as { columns: { column_name: string; label: string }[] }
  expect(def.columns.find((c) => c.column_name === 'glor')?.label).toBe('Floor')
})

test('a system Table refuses the whole editor', async ({ session }) => {
  await session
    .visit('/admin/Import%20Log/columns')
    .assertHas('[data-testid="ce-system"]', { text: 'system Table' })
    .refuteHas('[data-testid="ce-add"]')
    .refuteHas('[data-testid="ce-rename-file_name"]')
})

test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('keeps the Columns table inside its own scroll area and Rename reachable', async ({ session }) => {
    await session.visit(`/admin/${encodeURIComponent(DT)}/columns`)

    await session
      .within('main', (main) => main.assertNoHorizontalOverflow())
      .within('[data-testid="ce-columns-table"]', (table) =>
        table.assertHorizontalOverflow().scrollToHorizontalEnd(),
      )
      .clickButton('Rename glor')
      .assertHas('[data-testid="ce-rename-input-glor"]')
  })
})
