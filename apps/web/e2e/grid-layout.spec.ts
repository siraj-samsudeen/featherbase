import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Form A'
const SEC_DT = 'UI Section DT'

let token = ''
let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  const metaA = await request.get(`/api/meta/${encodeURIComponent(DT)}`, { headers: auth })
  test.skip(metaA.status() === 404, 'run formview.spec first')

  const created = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: {
      title: 'grid fixture',
      items: [{ item: 'one', qty: 1 }, { item: 'two', qty: 2 }, { item: 'three', qty: 3 }],
    },
  })
  docName = ((await created.json()) as { name: string }).name

  const metaS = await request.get(`/api/meta/${encodeURIComponent(SEC_DT)}`, { headers: auth })
  if (metaS.status() === 404) {
    await request.post('/api/doctype', {
      headers: auth,
      data: {
        name: SEC_DT,
        fields: [
          { fieldname: 'a1', fieldtype: 'Data', label: 'A One' },
          { fieldname: 'a2', fieldtype: 'Data', label: 'A Two' },
          { fieldname: 'sec_b', fieldtype: 'Section Break', label: 'Details' },
          { fieldname: 'b1', fieldtype: 'Data', label: 'B One' },
          { fieldname: 'col_b', fieldtype: 'Column Break' },
          { fieldname: 'b2', fieldtype: 'Data', label: 'B Two' },
        ],
      },
    })
  }
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)
}

test('UI-007: child grid add/edit/delete/reorder round-trips through save', async ({ page, request }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  const grid = page.getByTestId('table-items')
  await expect(grid.locator('tbody tr')).toHaveCount(3)

  // Edit row 2's qty
  await grid.locator('tbody tr').nth(1).locator('[data-childfield=qty]').fill('22')
  // Delete row 3
  await grid.locator('tbody tr').nth(2).getByRole('button', { name: 'Remove row' }).click()
  await expect(grid.locator('tbody tr')).toHaveCount(2)
  // Add a new row
  await page.getByTestId('add-row-items').click()
  await grid.locator('tbody tr').nth(2).locator('[data-childfield=item]').fill('added')
  await grid.locator('tbody tr').nth(2).locator('[data-childfield=qty]').fill('9')
  // Move the new row up (added, position 3 -> 2)
  await grid.locator('tbody tr').nth(2).getByRole('button', { name: 'Move row up' }).click()
  await expect(grid.locator('tbody tr').nth(1).locator('[data-childfield=item]')).toHaveValue('added')

  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')

  // DB reflects content and order exactly
  const res = await request.get(
    `/api/resource/${encodeURIComponent(DT)}/${docName}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const doc = (await res.json()) as { items: { item: string; qty: string; idx: number }[] }
  expect(doc.items.map((r) => [r.item, Number(r.qty), r.idx])).toEqual([
    ['one', 1, 1],
    ['added', 9, 2],
    ['two', 22, 3],
  ])
})

test('UI-008: Section and Column Breaks produce grouped sections in metadata order', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(SEC_DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Two sections: 0 has a1+a2, 1 has b1+b2 (with a column break between)
  const s0 = page.getByTestId('form-section-0')
  const s1 = page.getByTestId('form-section-1')
  await expect(s0.locator('[data-field=a1]')).toBeVisible()
  await expect(s0.locator('[data-field=a2]')).toBeVisible()
  await expect(s0.locator('[data-field=b1]')).toHaveCount(0)
  await expect(s1.locator('[data-field=b1]')).toBeVisible()
  await expect(s1.locator('[data-field=b2]')).toBeVisible()
})

test('UI-016: breadcrumbs navigate and the title bar tracks saved state', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)

  const crumbs = page.getByTestId('breadcrumbs')
  await expect(crumbs).toContainText('Desk')
  await expect(crumbs).toContainText(DT)
  await expect(crumbs).toContainText(docName)

  await expect(page.getByTestId('form-status')).toContainText('Saved')
  await page.locator('[data-field=title]').fill('status probe')
  await expect(page.getByTestId('form-status')).toContainText('Not saved')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  await expect(page.getByTestId('form-status')).toContainText('Saved')

  // Breadcrumb doctype link returns to the list
  await crumbs.getByText(DT).click()
  await expect(page.getByTestId('list-view')).toBeVisible()
})
