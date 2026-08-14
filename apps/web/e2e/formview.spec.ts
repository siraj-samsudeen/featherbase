import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Form A'
const ROW = 'UI Form Row'
const CUST = 'UI Form Cust'

let docName = ''

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
  docName = ((await created.json()) as { row_id: string }).row_id
}

test.beforeAll(async ({ request }) => {
  await ensureFixtures(request)
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)
}

test('UI-004: FormView renders every field type as the correct control', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Data -> text input with value
  await expect(page.locator('[data-field=title]')).toHaveAttribute('type', 'text')
  await expect(page.locator('[data-field=title]')).toHaveValue('form fixture')
  // Int -> number input
  await expect(page.locator('[data-field=qty]')).toHaveAttribute('type', 'number')
  await expect(page.locator('[data-field=qty]')).toHaveValue('4')
  // Check -> checked checkbox
  await expect(page.locator('[data-field=done]')).toBeChecked()
  // Select -> select with the right option chosen
  await expect(page.locator('select[data-field=stage]')).toHaveValue('Open')
  // Date -> date picker input
  await expect(page.locator('[data-field=due]')).toHaveAttribute('type', 'date')
  await expect(page.locator('[data-field=due]')).toHaveValue('2026-08-01')
  // Link -> combobox input holding the linked name
  await expect(page.locator('[data-field=customer]')).toHaveAttribute('role', 'combobox')
  await expect(page.locator('[data-field=customer]')).toHaveValue('Formco')
  // Text -> textarea
  await expect(page.locator('textarea[data-field=notes]')).toContainText('multi')
  // Table -> child grid with both rows
  const grid = page.getByTestId('table-items')
  await expect(grid.locator('tbody tr')).toHaveCount(2)
  await expect(grid.locator('tbody tr').first().locator('[data-childfield=item]')).toHaveValue('bolt')
})

test('UI-005: save persists edits, shows dirty state and field-wise server errors inline', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-status')).toContainText('Saved')
  await expect(page.getByTestId('form-save')).toBeDisabled()

  // Edit -> dirty -> save -> persisted
  await page.locator('[data-field=title]').fill('edited via form')
  await expect(page.getByTestId('form-status')).toContainText('Not saved')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  await page.reload()
  await expect(page.locator('[data-field=title]')).toHaveValue('edited via form')

  // Server-side field error surfaces inline at the exact field
  await page.locator('[data-field=title]').fill('x'.repeat(150))
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('error-title')).toBeVisible()
  await expect(page.getByTestId('form-status')).toContainText('Not saved')

  // Fix it and save again
  await page.locator('[data-field=title]').fill('recovered')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
})
