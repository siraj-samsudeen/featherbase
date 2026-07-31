import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Resp E2E Item'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'qty', column_type: 'Int', in_list_view: true },
        { column_name: 'notes', column_type: 'Text' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 'Widget', qty: 5 } })
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

test.describe('UI-025: responsive Admin (mobile)', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('sidebar collapses to a drawer and list/form are usable at mobile width', async ({ page }) => {
    await login(page)

    // The hamburger is shown; the sidebar starts off-screen (translated left).
    await expect(page.getByTestId('sidebar-toggle')).toBeVisible()
    const closedBox = await page.getByTestId('admin-sidebar').boundingBox()
    expect(closedBox).not.toBeNull()
    expect(closedBox!.x).toBeLessThan(0) // off-screen to the left

    // Opening the drawer brings the sidebar on-screen (wait out the transition).
    await page.getByTestId('sidebar-toggle').click()
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible()
    await expect
      .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
      .toBeGreaterThanOrEqual(0)

    // Navigating from the drawer closes it (#80: the drawer lists Home
    // Pages + All tables; the table link is then on the All tables page).
    await page.getByTestId('all-tables-link').click()
    await expect(page).toHaveURL(/\/admin\/all-tables/)
    await page.getByTestId(`doctype-nav`).getByText(DT, { exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))
    await expect(page.getByTestId('list-view')).toBeVisible()
    await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0)
    await expect
      .poll(async () => (await page.getByTestId('admin-sidebar').boundingBox())!.x)
      .toBeLessThan(0)

    // The list view does not force the page to scroll horizontally.
    expect(await noHorizontalOverflow(page)).toBe(true)

    // The form view is usable: fields stack in a single column (the second
    // field sits below the first, not beside it) and no horizontal overflow.
    await page.goto(`/admin/${encodeURIComponent(DT)}/new`)
    await expect(page.getByTestId('form-view')).toBeVisible()
    const f1 = await page.locator('[data-field=title]').boundingBox()
    const f2 = await page.locator('[data-field=qty]').boundingBox()
    expect(f1).not.toBeNull()
    expect(f2).not.toBeNull()
    expect(f2!.y).toBeGreaterThan(f1!.y + 10) // stacked, not side-by-side
    expect(await noHorizontalOverflow(page)).toBe(true)
  })
})

test.describe('UI-025: desktop keeps a static sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('sidebar is always visible and the hamburger is hidden', async ({ page }) => {
    await login(page)
    // On desktop the drawer toggle is hidden and the sidebar is on-screen.
    await expect(page.getByTestId('sidebar-toggle')).toBeHidden()
    const box = await page.getByTestId('admin-sidebar').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
  })
})
