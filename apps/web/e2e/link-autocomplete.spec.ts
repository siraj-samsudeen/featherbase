import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Form A'
const ROW = 'UI Form Row'
const CUST = 'UI Form Cust'

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  // Owns the DT/ROW/CUST fixtures rather than borrowing formview.spec's,
  // matching that spec's table shape exactly (DT's Sub-table column
  // references ROW, its Reference column references CUST, so both must
  // exist before DT does). Idempotent in either direction via the :meta
  // 404 check.
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
    const metaDef = await request.get(`/api/table/${encodeURIComponent(name)}:meta`, { headers: auth })
    if (metaDef.status() === 404) await request.post('/api/table_def', { headers: auth, data: def })
  }

  for (const c of ['Globex Ltd', 'Acme Ltd']) {
    const res = await request.post(`/api/table/${encodeURIComponent(CUST)}`, {
      headers: auth,
      data: { row_id: c, city: 'x' },
    })
    if (![201, 409].includes(res.status())) throw new Error(`cust: ${res.status()}`)
  }
  // Own doc, not "latest": grabbing the newest row races with other specs
  // editing their docs in parallel workers (modified-timestamp conflicts).
  const created = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { title: 'link autocomplete fixture', qty: 1 },
  })
  if (created.status() !== 201) throw new Error(`fixture doc: ${created.status()}`)
  docName = ((await created.json()) as { row_id: string }).row_id
})

test('UI-006: link autocomplete filters, selects, persists, and offers create-new', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  const input = page.locator('[data-field=customer]')
  await expect(input).toBeVisible()

  // Typing filters suggestions
  await input.fill('Ltd')
  const options = page.getByTestId('link-options-customer')
  await expect(options).toBeVisible()
  await expect(options.getByTestId('link-option')).toHaveCount(2)
  await expect(options).toContainText('Globex Ltd')
  await expect(options).toContainText('Acme Ltd')
  await expect(options).not.toContainText('Formco')

  // Narrow further
  await input.fill('Glob')
  await expect(options.getByTestId('link-option')).toHaveCount(1)

  // Picking one stores the name and saves
  await options.getByTestId('link-option').first().click()
  await expect(input).toHaveValue('Globex Ltd')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  await page.reload()
  await expect(page.locator('[data-field=customer]')).toHaveValue('Globex Ltd')

  // Create-new is offered from the dropdown and navigates to a blank form
  await page.locator('[data-field=customer]').fill('zzz-no-match')
  await expect(page.getByTestId('link-options-customer')).toContainText('No matches')
  await page.getByTestId('link-create-new').click()
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(CUST).replace(/%/g, '%')}/new`.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`)))
  await expect(page.getByTestId('form-status')).toContainText('New document')
})
