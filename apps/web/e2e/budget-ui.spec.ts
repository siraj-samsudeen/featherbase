import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Spec 0007 M2 in the browser: the Baseline button (BUD-J1.4's gap), the
// governed pill + pending badge + Propose change flow, the Snapshot button,
// and the compare view. One walk, in fiscal order.
//
// Isolation: journey-owned unique names; teardown closes the book and
// deletes the line table (applied changes are permanent by design).

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SFX = Math.random().toString(36).slice(2, 8)
const LINE = `Bgt M2 Line ${SFX}`
const BOOK = `Bgt M2 2026 ${SFX}`
const T = encodeURIComponent

let headers: Record<string, string> = {}
let lineName = ''

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  headers = { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` }

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
  if (dt.status() !== 201) throw new Error(`doctype: ${dt.status()}`)
  const row = await request.post(`/api/table/${T(LINE)}`, {
    headers,
    data: { store: 'Adyar', subcategory: 'Juices', q1: 100, q2: 100 },
  })
  lineName = ((await row.json()) as { row_id: string }).row_id

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
})

test.afterAll(async ({ request }: { request: APIRequestContext }) => {
  await request.post(`/api/table/${T('Budget Book')}/${T(BOOK)}:close`, { headers, data: {} })
  await request.delete(`/api/table_def/${T(LINE)}`, { headers })
})

test('M2: baseline button → governed pill → propose → submit → snapshot → compare', async ({
  page,
  request,
}) => {
  await login(page)

  // J1.4 in the browser: the Baseline button freezes the book.
  await page.goto(`/admin/${T('Budget Book')}/${T(BOOK)}`)
  await expect(page.getByTestId('budget-lifecycle')).toHaveText('working')
  await page.getByTestId('budget-baseline').click()
  await page.getByTestId('budget-baseline-go').click()
  await expect(page.getByTestId('budget-lifecycle')).toHaveText('active')

  // The governed line advertises its book and the way in.
  await page.goto(`/admin/${T(LINE)}/${T(lineName)}`)
  await expect(page.getByTestId('budget-governed-pill')).toContainText(BOOK)
  await page.getByTestId('budget-propose').click()

  // The new-change form arrives prefilled: book set, one line loaded.
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.locator('[data-field=book]')).toHaveValue(BOOK)
  const grid = page.getByTestId('table-lines')
  await expect(grid.locator('[data-childfield=line_ref]')).toHaveValue(lineName)

  // Priya types her proposal: q2 → 80, with the reason.
  await grid.locator('[data-childfield=measure_column]').fill('q2')
  await grid.locator('[data-childfield=proposed_value]').fill('80')
  await page.locator('[data-field=reason]').fill('Supplier exiting the region from Q2')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('status-badge')).toContainText('Draft')

  // The save snapped the facts (current 100 → delta −20 → total −20).
  await expect(page.locator('[data-field=total_delta]')).toHaveValue('-20')

  // A second draft via API so the pending badge has something to count.
  const draft2 = await request.post(`/api/table/${T('Budget Change')}`, {
    headers,
    data: {
      book: BOOK,
      change_type: 'revise',
      reason: 'parallel thought',
      lines: [{ line_ref: lineName, measure_column: 'q1', proposed_value: 90 }],
    },
  })
  if (draft2.status() !== 201) throw new Error(`draft2: ${draft2.status()}`)

  // Approve the proposal. Under the demo app's workflow the generic Submit
  // hides (BUD-R11) and the fast-lane transition approves; without a
  // workflow the generic Submit applies.
  const fastLane = page.getByTestId('workflow-action-Self-approve')
  if (await fastLane.count()) await fastLane.click()
  else await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('status-badge')).toContainText('Submitted')

  // The line shows the applied value and counts the remaining pending draft.
  await page.goto(`/admin/${T(LINE)}/${T(lineName)}`)
  await expect(page.locator('[data-field=q2]')).toHaveValue(/^80(\.0+)?$/)
  await expect(page.getByTestId('budget-pending-badge')).toContainText('1 pending')

  // Snapshot from the book form…
  await page.goto(`/admin/${T('Budget Book')}/${T(BOOK)}`)
  await page.getByTestId('budget-snapshot').click()
  await page.getByTestId('budget-snapshot-label').fill('LE-e2e')
  await page.getByTestId('budget-snapshot-go').click()
  await expect(page.getByTestId('budget-snapshot-label')).toHaveCount(0)

  // …and compare v0 against Current: exactly the q2 change shows.
  await page.getByTestId('budget-compare-link').click()
  await expect(page.getByTestId('budget-compare')).toBeVisible()
  await page.getByTestId('compare-from').selectOption({ label: 'v0 (baseline)' })
  await page.getByTestId('compare-to').selectOption({ label: 'Current' })
  await expect(page.getByTestId('compare-result')).toBeVisible()
  const lines = page.getByTestId('compare-line')
  await expect(lines).toHaveCount(1)
  await expect(lines.first()).toContainText('Adyar')
  await expect(lines.first()).toContainText('changed')
})
