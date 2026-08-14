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
