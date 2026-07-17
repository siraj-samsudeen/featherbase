import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT_A = 'UI List A' // fixtures created by listview.spec (idempotent)

test('UI-003: filters narrow results, persist in the URL across reload, and are removable', async ({ page, request }) => {
  // Ensure fixtures exist (listview.spec setup is idempotent; replicate minimal check)
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const listA = await request.get(`/api/resource/${encodeURIComponent(DT_A)}?limit_page_length=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  test.skip(listA.status() === 404, 'run listview.spec first to create fixtures')

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT_A)}`)
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
