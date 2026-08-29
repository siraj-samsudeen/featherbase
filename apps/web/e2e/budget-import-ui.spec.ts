import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

// Spec 0007, BUD-J4 at the browser tier (M3 UI): a typical user drops the
// August overwrite on the Import wizard; the governed target swaps the
// import flow for the proposal flow — reason, preview, draft Budget
// Changes — and approving a draft applies it. No API calls by the user.
//
// Isolation: journey-owned unique names; teardown closes the book and
// deletes the line table (applied changes are permanent by design).

const SFX = Math.random().toString(36).slice(2, 8)
const LINE = `Bgt Wiz Line ${SFX}`
const BOOK = `Bgt Wiz 2026 ${SFX}`
const T = encodeURIComponent

let headers: Record<string, string> = {}
let bevRowId = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  headers = await adminAuth(request)

  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: LINE,
      columns: [
        { column_name: 'store', column_type: 'Data', in_list_view: true },
        { column_name: 'subcategory', column_type: 'Data', in_list_view: true },
        { column_name: 'q1', column_type: 'Currency', in_list_view: true },
        { column_name: 'q2', column_type: 'Currency', in_list_view: true },
      ],
    },
  })
  if (dt.status() !== 201) throw new Error(`table_def: ${dt.status()}`)
  for (const row of [
    { store: 'Adyar', subcategory: 'Beverages', q1: 100, q2: 100 },
    { store: 'Adyar', subcategory: 'Snacks', q1: 50, q2: 50 },
  ]) {
    const r = await request.post(`/api/table/${T(LINE)}`, { headers, data: row })
    if (r.status() !== 201) throw new Error(`row: ${r.status()}`)
    if (row.subcategory === 'Beverages')
      bevRowId = ((await r.json()) as { row_id: string }).row_id
  }
  const book = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Budget Book',
      row: {
        row_id: BOOK,
        ref_table: LINE,
        fiscal_year: '2026',
        key_columns: [{ column_name: 'store' }, { column_name: 'subcategory' }],
        measure_columns: [
          { column_name: 'q1', period_label: 'Q1' },
          { column_name: 'q2', period_label: 'Q2' },
        ],
      },
    },
  })
  if (![200, 201].includes(book.status())) throw new Error(`book: ${book.status()}`)
  const base = await request.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:baseline`, {
    headers,
    data: {},
  })
  if (base.status() !== 200) throw new Error(`baseline: ${base.status()}`)
})

test.afterAll(async ({ request }: { request: APIRequestContext }) => {
  await request.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:close`, { headers, data: {} })
  await request.delete(`/api/table_def/${T(LINE)}`, { headers })
})

test('BUD-J4 in the wizard: drop the August file → governed panel → preview → drafts → approve', async ({
  page,
}) => {
  // The wizard, opened from the governed table (the ?table= pin).
  await page.goto(`/admin/import?table=${T(LINE)}`)
  // The August file: one changed cell (Beverages q2 100→80), one new row,
  // and Adyar/Snacks missing (to be discontinued).
  await page.setInputFiles('[data-testid=iw-file-input]', {
    name: 'august-update.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'store,subcategory,q1,q2\nAdyar,Beverages,100,80\nVelachery,Juices,40,40\n',
    ),
  })

  // The governed banner names the book; the plain-import controls are gone.
  await expect(page.getByTestId('iw-gov-banner-0')).toContainText(BOOK)
  await expect(page.getByTestId('iw-key-0')).toHaveCount(0)
  await expect(page.getByTestId('iw-import')).toHaveCount(0)

  // Reason first — the buttons stay disabled without one.
  await expect(page.getByTestId('iw-gov-preview-0')).toBeDisabled()
  await page.getByTestId('iw-gov-reason-0').fill('August reforecast')
  await page.getByTestId('iw-gov-missing-0').check()
  await page.getByTestId('iw-gov-effective-0').selectOption('q2')

  // Preview: the diff, nothing written.
  await page.getByTestId('iw-gov-preview-0').click()
  const previewText = page.getByTestId('iw-gov-preview-result-0')
  await expect(previewText).toContainText('3')
  await expect(previewText).toContainText('1 changed cell')
  await expect(previewText).toContainText('1 new row')
  await expect(previewText).toContainText('1 discontinued')

  // Create: three drafts, linked.
  await page.getByTestId('iw-gov-create-0').click()
  const result = page.getByTestId('iw-gov-result-0')
  await expect(result).toContainText('Created 3 draft Budget Changes')
  const links = result.locator('a')
  await expect(links).toHaveCount(3)

  // Approve the revise draft (first in plan order) in the generic FormView.
  await links.first().click()
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.locator('[data-field=reason]')).toHaveValue('August reforecast')
  await expect(page.locator('[data-field=total_delta]')).toHaveValue('-20')
  const fastLane = page.getByTestId('workflow-action-Self-approve')
  if (await fastLane.count()) await fastLane.click()
  else await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('status-badge')).toContainText('Submitted')

  // The bound row carries the applied value.
  await page.goto(`/admin/${T(LINE)}/${T(bevRowId)}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.locator('[data-field=q2]')).toHaveValue(/^80(\.0+)?$/)
})
