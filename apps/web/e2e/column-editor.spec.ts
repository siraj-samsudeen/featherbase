import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #209 (issue #197): "after importing I want to add a certain column but
// today it is not possible", and "in one of the things floor was spelled
// with a G, Glor".
//
// The Table Builder only ever built NEW Tables. A Table with rows in it had
// no way to grow a column, and a misspelled column name had no way back —
// the PUT route matches columns by name, so a changed name reads as
// delete-plus-add and orphans the rows.

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

test('a misspelled column is renamed, and its rows come with it', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto(`/admin/${encodeURIComponent(DT)}`)

  // Reachable from the Table it belongs to.
  await page.getByTestId('open-columns').click()
  await expect(page.getByTestId('column-editor')).toBeVisible()
  await expect(page.getByTestId('ce-row-glor')).toBeVisible()

  await page.getByTestId('ce-rename-glor').click()
  await page.getByTestId('ce-rename-input-glor').fill('floor')
  await page.getByTestId('ce-rename-go-glor').click()

  await expect(page.getByTestId('ce-row-floor')).toBeVisible()
  await expect(page.getByTestId('ce-row-glor')).toHaveCount(0)

  // The whole point: the values were already right.
  const rows = await request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["floor","pop"]')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  expect(data.map((r) => r.floor).sort()).toEqual(['Ground', 'Mezzanine'])
})

test('a rename that collides is refused, in place, with the reason', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/columns`)
  await page.getByTestId('ce-rename-glor').click()
  await page.getByTestId('ce-rename-input-glor').fill('pop')
  await page.getByTestId('ce-rename-go-glor').click()

  await expect(page.getByTestId('ce-rename-error-glor')).toContainText('already has')
  // And nothing moved.
  await expect(page.getByTestId('ce-row-glor')).toBeVisible()
  await expect(page.getByTestId('ce-row-pop')).toBeVisible()
})

test('a column is added to a Table that already has rows', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto(`/admin/${encodeURIComponent(DT)}/columns`)

  // The machine name follows the label until it is claimed.
  await page.getByTestId('ce-add-label').fill('Aisle Code')
  await expect(page.getByTestId('ce-add-name')).toHaveValue('aisle_code')
  await page.getByTestId('ce-add-go').click()

  await expect(page.getByTestId('ce-saved')).toContainText('Added aisle_code')
  await expect(page.getByTestId('ce-row-aisle_code')).toBeVisible()

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

test('a name the server would reject is caught before the round trip', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/columns`)

  await page.getByTestId('ce-add-label').fill('Glor')
  await expect(page.getByTestId('ce-add-problem')).toContainText('already has glor')
  await expect(page.getByTestId('ce-add-go')).toBeDisabled()

  await page.getByTestId('ce-add-name').fill('created_at')
  await expect(page.getByTestId('ce-add-problem')).toContainText('standard column')
  await expect(page.getByTestId('ce-add-go')).toBeDisabled()

  await page.getByTestId('ce-add-name').fill('Not Snake')
  await expect(page.getByTestId('ce-add-problem')).toContainText('snake_case')

  await page.getByTestId('ce-add-name').fill('aisle')
  await expect(page.getByTestId('ce-add-go')).toBeEnabled()
})

test('a label is changed without touching the column or its data', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto(`/admin/${encodeURIComponent(DT)}/columns`)

  await page.getByTestId('ce-label-glor').fill('Floor')
  await page.getByTestId('ce-label-save-glor').click()
  await expect(page.getByTestId('ce-saved')).toContainText('glor')
  await expect(page.getByTestId('ce-label-glor')).toHaveValue('Floor')

  // The machine name — and therefore every row — is untouched.
  const meta = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const def = (await meta.json()) as { columns: { column_name: string; label: string }[] }
  expect(def.columns.find((c) => c.column_name === 'glor')?.label).toBe('Floor')
})

test('a system Table refuses the whole editor', async ({ page }) => {
  await page.goto('/admin/Import%20Log/columns')
  await expect(page.getByTestId('ce-system')).toContainText('system Table')
  await expect(page.getByTestId('ce-add')).toHaveCount(0)
  await expect(page.getByTestId('ce-rename-file_name')).toHaveCount(0)
})
