import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'List Edit DT'

// List editing (owner-ratified 2026-08-14): the generic ListView carries
// three view-level toggles — List (row click side-peeks the form), Grid
// (Excel-like cells, per-row autosave on row exit), Datasheet (always-
// editable cells + ghost new row). The chosen view persists per user.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
        { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
        { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { name: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/table/${encodeURIComponent(DT)}/${row.name}`, { headers: auth })
  for (const [title, city, qty] of [
    ['alpha', 'Chennai', 1],
    ['beta', 'Madurai', 2],
    ['gamma', 'Salem', 3],
  ] as const) {
    await request.post(`/api/table/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, city, qty },
    })
  }
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

// Rows are hash-named; the API maps a title to its row name (and current
// field values). Datasheet cells are inputs, whose values are invisible to
// text locators — rows are addressed by data-row-name instead.
async function fetchRows(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const fields = encodeURIComponent(JSON.stringify(['name', 'title', 'city', 'qty']))
  const res = await page.request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${fields}&limit_page_length=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  // Int columns arrive as strings on the list wire (postgres client numerics).
  return ((await res.json()) as {
    data: { name: string; title: string; city: string | null; qty: number | string | null }[]
  }).data
}

test('view toggle switches modes and the choice persists per user', async ({ page }) => {
  await signIn(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}`)

  // List is the default; the other two are one click away.
  await expect(page.getByTestId('view-toggle-list')).toBeVisible()
  await page.getByTestId('view-toggle-grid').click()
  await expect(page.getByTestId('grid-view')).toBeVisible()
  await page.getByTestId('view-toggle-sheet').click()
  await expect(page.getByTestId('sheet-view')).toBeVisible()

  // The chosen view survives a reload (per-user setting, like sort).
  await page.reload()
  await expect(page.getByTestId('sheet-view')).toBeVisible()
  await page.getByTestId('view-toggle-list').click()
  await expect(page.getByTestId('list-rows')).toBeVisible()
})

test('grid: edit a cell, leave the row — the row autosaves via the server', async ({ page }) => {
  await signIn(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await page.getByTestId('view-toggle-grid').click()
  await expect(page.getByTestId('grid-view')).toBeVisible()

  // alpha's City cell: click to select, Enter to edit, type, Enter commits
  // and moves down — leaving the row is the autosave moment.
  const alphaName = (await fetchRows(page)).find((r) => r.title === 'alpha')!.name
  const alphaRow = page.locator(`[data-row-name="${alphaName}"]`)
  await alphaRow.getByTestId('grid-cell-city').click()
  await page.keyboard.press('Enter')
  await page.getByTestId('grid-cell-editor').fill('Tirunelveli')
  await page.keyboard.press('Enter')

  await expect(alphaRow.getByTestId('row-saved')).toBeVisible()
  await expect(alphaRow.getByTestId('grid-cell-city')).toHaveText('Tirunelveli')

  // The server, not local state, is the record: verify over the API.
  expect((await fetchRows(page)).find((r) => r.title === 'alpha')?.city).toBe('Tirunelveli')

  // Back to list for the next test's default.
  await page.getByTestId('view-toggle-list').click()
})

test('datasheet: direct cell edit autosaves on row exit; ghost row creates', async ({ page }) => {
  await signIn(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await page.getByTestId('view-toggle-sheet').click()
  await expect(page.getByTestId('sheet-view')).toBeVisible()

  // Edit beta's qty in place, then click elsewhere to leave the row.
  const betaName = (await fetchRows(page)).find((r) => r.title === 'beta')!.name
  const betaRow = page.locator(`[data-row-name="${betaName}"]`)
  await betaRow.getByTestId('sheet-cell-qty').locator('input').fill('42')
  await page.getByTestId('list-total').click()
  await expect(betaRow.getByTestId('row-saved')).toBeVisible()

  // Ghost row: type a title and press Enter — a real row appears.
  await page.getByTestId('sheet-ghost-title').fill('delta')
  await page.getByTestId('sheet-ghost-title').press('Enter')
  await expect(page.getByTestId('list-total')).toContainText('4 total')

  const listed = await fetchRows(page)
  expect(Number(listed.find((r) => r.title === 'beta')?.qty)).toBe(42)
  expect(listed.some((r) => r.title === 'delta')).toBe(true)

  await page.getByTestId('view-toggle-list').click()
})
