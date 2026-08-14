import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Spec 0007 (Budget Books), BUD-J2 at the browser tier: a proposed Budget
// Change renders its computed facts in the generic FormView, approves via
// the generic Submit button (UI-010), and the bound line then shows the
// applied value with the Version diff on its activity timeline.
//
// Isolation: journey-owned unique names per run — an applied Budget Change
// is deliberately permanent (BUD-R9), so this journey cannot fully
// self-clean; teardown closes the book and deletes the line table, and the
// unique suffix keeps a crashed run from blocking the next.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SFX = Math.random().toString(36).slice(2, 8)
const LINE = `Bgt Ui Line ${SFX}`
const BOOK = `Bgt Ui 2026 ${SFX}`
const T = encodeURIComponent

let token = ''
let headers: Record<string, string> = {}
let lineName = ''
let changeName = ''

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  token = ((await res.json()) as { token: string }).token
  headers = { Authorization: `Bearer ${token}` }

  const dt = await request.post('/api/doctype', {
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
  if (dt.status() !== 201) throw new Error(`doctype: ${dt.status()}`)

  const row = await request.post(`/api/table/${T(LINE)}`, {
    headers,
    data: { store: 'Adyar', subcategory: 'Beverages', q1: 100, q2: 100 },
  })
  lineName = ((await row.json()) as { name: string }).name

  const book = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Budget Book',
      doc: {
        name: BOOK,
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

  // Baseline via API — the M1 FormView has no generic row-action button
  // yet (an M2 item); the spec's J1.4 browser step is covered at api tier.
  const base = await request.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:baseline`, {
    headers,
    data: {},
  })
  if (base.status() !== 200) throw new Error(`baseline: ${base.status()}`)

  const change = await request.post(`/api/table/${T('Budget Change')}`, {
    headers,
    data: {
      book: BOOK,
      change_type: 'revise',
      reason: 'Supplier exiting the region from Q2',
      lines: [{ line_ref: lineName, measure_column: 'q2', proposed_value: 80 }],
    },
  })
  if (change.status() !== 201) throw new Error(`change: ${change.status()}`)
  changeName = ((await change.json()) as { name: string }).name
})

test.afterAll(async ({ request }: { request: APIRequestContext }) => {
  await request.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:close`, { headers, data: {} })
  await request.delete(`/api/doctype/${T(LINE)}`, { headers })
})

test('BUD-J2: the change form shows computed facts, submits, and the line shows value + trail', async ({
  page,
}) => {
  await login(page)

  // J2.1 — the draft renders its computed facts in the generic FormView.
  await page.goto(`/admin/${T('Budget Change')}/${T(changeName)}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('status-badge')).toContainText('Draft')
  await expect(page.locator('[data-field=total_delta]')).toHaveValue('-20')

  // J2.2 — approve. On a DB carrying the demo app, its workflow governs
  // Budget Change (BUD-R11 hides the generic Submit and the fast-lane
  // transition is the way through); otherwise the generic Submit applies.
  const fastLane = page.getByTestId('workflow-action-Self-approve')
  if (await fastLane.count()) await fastLane.click()
  else await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('status-badge')).toContainText('Submitted')

  // J2.2 — the bound line carries the applied value.
  await page.goto(`/admin/${T(LINE)}/${T(lineName)}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.locator('[data-field=q2]')).toHaveValue(/^80(\.0+)?$/)

  // J2.3 — the line's timeline shows the Version diff for q2.
  await expect(page.getByTestId('activity-timeline')).toBeVisible()
  const diff = page.getByTestId('activity-diff').first()
  await expect(diff).toContainText('q2')

  // BUD-R3 seen from the browser: editing a governed measure is refused
  // with an error naming the book, and the value stands.
  await page.fill('[data-field=q2]', '55')
  await page.getByTestId('form-save').click()
  await expect(page.getByText(new RegExp(BOOK))).toBeVisible()
})
