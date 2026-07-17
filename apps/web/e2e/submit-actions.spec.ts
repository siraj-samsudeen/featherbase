import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Sub Order'

let token = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const meta = await request.get(`/api/meta/${encodeURIComponent(DT)}`, { headers: auth })
  if (meta.status() === 404) {
    await request.post('/api/doctype', {
      headers: auth,
      data: {
        name: DT,
        is_submittable: true,
        fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title', reqd: true }],
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

test('UI-010: draft shows Submit; submitted shows Cancel + locks fields; cancelled shows Amend', async ({ page, request }) => {
  // fresh draft
  const created = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'action doc' },
  })
  const docName = ((await created.json()) as { name: string }).name

  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Draft: badge Draft, Submit button present, field editable
  await expect(page.getByTestId('docstatus-badge')).toContainText('Draft')
  await expect(page.getByTestId('form-submit')).toBeVisible()
  await expect(page.locator('[data-field=title]')).toBeEnabled()

  // Submit -> Submitted, fields locked, Cancel present, Submit gone
  await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('docstatus-badge')).toContainText('Submitted')
  await expect(page.getByTestId('form-cancel')).toBeVisible()
  await expect(page.getByTestId('form-submit')).toHaveCount(0)
  await expect(page.locator('[data-field=title]')).toBeDisabled()

  // Cancel -> Cancelled, Amend present
  await page.getByTestId('form-cancel').click()
  await expect(page.getByTestId('docstatus-badge')).toContainText('Cancelled')
  await expect(page.getByTestId('form-amend')).toBeVisible()

  // Amend -> navigates to a new draft (name-1) editable
  await page.getByTestId('form-amend').click()
  await expect(page).toHaveURL(new RegExp(`/desk/${encodeURIComponent(DT)}/${docName}-1`))
  await expect(page.getByTestId('docstatus-badge')).toContainText('Draft')
  await expect(page.locator('[data-field=title]')).toBeEnabled()
  await expect(page.locator('[data-field=title]')).toHaveValue('action doc')
})
