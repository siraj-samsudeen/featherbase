import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT_A = 'UI List A' // fixtures created by listview.spec (idempotent)

test('UI-003: filters narrow results, persist in the URL across reload, and are removable', async ({ page, request }) => {
  // Ensure fixtures exist (listview.spec setup is idempotent; replicate minimal check)
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const listA = await request.get(`/api/table/${encodeURIComponent(DT_A)}?limit_page_length=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  test.skip(listA.status() === 404, 'run listview.spec first to create fixtures')

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  await page.goto(`/admin/${encodeURIComponent(DT_A)}`)
  await expect(page.getByTestId('list-total')).toContainText('30 total')

  // qty >= 25 -> 5 rows
  await page.getByTestId('filter-field').selectOption('qty')
  await page.getByTestId('filter-op').selectOption('>=')
  await page.getByTestId('filter-value').fill('25')
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('list-total')).toContainText('5 total')
  await expect(page.getByTestId('filter-chip')).toHaveCount(1)
  expect(page.url()).toContain('filters=')

  // stack a like filter: title like %item-2% -> qty 25..29 all match item-2X
  await page.getByTestId('filter-field').selectOption('title')
  await page.getByTestId('filter-op').selectOption('like')
  await page.getByTestId('filter-value').fill('item-2')
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('filter-chip')).toHaveCount(2)
  await expect(page.getByTestId('list-total')).toContainText('5 total')

  // narrow further: qty = 27 via like on exact title
  await page.getByTestId('filter-field').selectOption('title')
  await page.getByTestId('filter-op').selectOption('=')
  await page.getByTestId('filter-value').fill('item-27')
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('list-total')).toContainText('1 total')
  await expect(page.getByTestId('list-rows')).toContainText('item-27')

  // reload: filters restored from URL, results still filtered
  await page.reload()
  await expect(page.getByTestId('filter-chip')).toHaveCount(3)
  await expect(page.getByTestId('list-total')).toContainText('1 total')

  // remove a chip -> widens again
  await page.getByTestId('filter-chip').last().getByRole('button').click()
  await expect(page.getByTestId('filter-chip')).toHaveCount(2)
  await expect(page.getByTestId('list-total')).toContainText('5 total')
})

// #87: a filtered list URL is shareable — it has to work when it arrives from
// somewhere other than an in-app navigation (pasted, bookmarked, typed). The
// router's search parser JSON-parses each value, so `filters` reaches the
// route as an Array; it used to be dropped for not being a string, taking the
// filters out of the address bar with it.
// Owns its fixture rather than borrowing listview.spec's: a regression test
// that silently skips on a fresh database is not a regression test.
const DT_COLD = 'UI Filter Cold'

test('#87: a filters URL applies when opened cold, not just when the app built it', async ({
  page,
  request,
}) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  const meta = await request.get(`/api/table/${encodeURIComponent(DT_COLD)}:meta`, { headers: auth })
  if (meta.status() === 404) {
    await request.post('/api/doctype', {
      headers: auth,
      data: {
        name: DT_COLD,
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
          { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
        ],
      },
    })
  }
  // This table belongs to this test alone, so it is emptied and refilled to
  // exactly ten rows. Seeding "up to ten" instead would depend on what an
  // earlier run left behind, and the assertions below count rows exactly.
  const existing = await request.get(
    `/api/table/${encodeURIComponent(DT_COLD)}?limit_page_length=500`,
    { headers: auth },
  )
  for (const row of ((await existing.json()) as { data: { name: string }[] }).data) {
    await request.delete(`/api/table/${encodeURIComponent(DT_COLD)}/${row.name}`, { headers: auth })
  }
  for (let i = 0; i < 10; i++) {
    await request.post(`/api/table/${encodeURIComponent(DT_COLD)}`, {
      headers: auth,
      data: { title: `cold-${i}`, qty: i },
    })
  }

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  // Typed by hand, never built by the app: qty >= 7 -> 3 of the 10 rows.
  // Filters are [field, op, value] triples (see `parsed` in router.tsx).
  const filters = encodeURIComponent(JSON.stringify([['qty', '>=', 7]]))
  await page.goto(`/admin/${encodeURIComponent(DT_COLD)}?filters=${filters}`)

  await expect(page.getByTestId('filter-chip')).toHaveCount(1)
  await expect(page.getByTestId('list-total')).toHaveText('3 total')
  // The parameter is still in the address bar — not silently stripped.
  expect(page.url()).toContain('filters=')

  // And it survives a reload, the same as an app-built one.
  await page.reload()
  await expect(page.getByTestId('filter-chip')).toHaveCount(1)
  await expect(page.getByTestId('list-total')).toHaveText('3 total')

  // A URL is user input. Values that parse as JSON but are the wrong shape are
  // discarded, not handed to ListView — which indexes each entry as a triple
  // and would throw, blanking the page.
  for (const bad of ['{}', '[null]', '["qty",">=",7]', '[["qty"]]', 'not json']) {
    await page.goto(`/admin/${encodeURIComponent(DT_COLD)}?filters=${encodeURIComponent(bad)}`)
    await expect(page.getByTestId('list-total')).toHaveText('10 total')
    await expect(page.getByTestId('filter-chip')).toHaveCount(0)
  }
})
