import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Form A'
const ROW = 'UI Form Row'
const CUST = 'UI Form Cust'

// Owns its fixtures rather than borrowing formview.spec's: this spec sorts
// before formview.spec alphabetically, so under an isolated fresh DB
// (pnpm --filter web e2e) it would self-skip on every run. Table shape is
// reused exactly from formview.spec's ensureFixtures so creation is
// idempotent in either direction — whichever spec runs first creates it,
// the other just finds it already there (:meta 404 check / [201, 409]).
async function ensureFixtures(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  const defs: [string, Record<string, unknown>][] = [
    [CUST, { name: CUST, id_pattern: 'prompt', columns: [{ column_name: 'city', column_type: 'Data' }] }],
    [ROW, {
      name: ROW,
      kind: 'sub_table',
      columns: [
        { column_name: 'item', column_type: 'Data', label: 'Item' },
        { column_name: 'qty', column_type: 'Int', label: 'Qty' },
      ],
    }],
    [DT, {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
        { column_name: 'qty', column_type: 'Int', label: 'Qty' },
        { column_name: 'done', column_type: 'Check', label: 'Done' },
        { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed' },
        { column_name: 'due', column_type: 'Date', label: 'Due' },
        { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: CUST },
        { column_name: 'notes', column_type: 'Text', label: 'Notes' },
        { column_name: 'items', column_type: 'Sub-table', label: 'Items', row_table: ROW },
      ],
    }],
  ]
  for (const [name, def] of defs) {
    const meta = await request.get(`/api/table/${encodeURIComponent(name)}:meta`, { headers: auth })
    if (meta.status() === 404) await request.post('/api/table_def', { headers: auth, data: def })
  }
  const cust = await request.post(`/api/table/${encodeURIComponent(CUST)}`, {
    headers: auth,
    data: { row_id: 'Formco', city: 'Chennai' },
  })
  if (![201, 409].includes(cust.status())) throw new Error(`cust fixture: ${cust.status()}`)
  const created = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: {
      title: 'form fixture',
      qty: 4,
      done: true,
      stage: 'Open',
      due: '2026-08-01',
      customer: 'Formco',
      notes: 'multi\nline',
      items: [{ item: 'bolt', qty: 2 }, { item: 'nut', qty: 6 }],
    },
  })
  if (created.status() !== 201) throw new Error(`doc fixture: ${created.status()} ${await created.text()}`)
}

test.beforeAll(async ({ request }) => {
  await ensureFixtures(request)
})

test('UI-009 + META-013: missing reqd field errors inline via shared zod schema, with NO network call', async ({ page, request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const list = await request.get(
    `/api/table/${encodeURIComponent(DT)}?limit_page_length=1&order_by=created_at desc`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const docName = ((await list.json()) as { data: { row_id: string }[] }).data[0].row_id

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  let saveCalls = 0
  await page.route('**/api/save_row', async (route) => {
    saveCalls++
    await route.continue()
  })

  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Clear the required title and try to save: inline error, zero network calls
  await page.locator('[data-field=title]').fill('')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('error-title')).toBeVisible()
  await expect(page.getByTestId('error-title')).toContainText(/Required/i)
  expect(saveCalls).toBe(0)

  // Bad date via direct value also caught client-side (type=number guard etc.)
  await page.locator('[data-field=title]').fill('client valid again')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  expect(saveCalls).toBe(1)
})
