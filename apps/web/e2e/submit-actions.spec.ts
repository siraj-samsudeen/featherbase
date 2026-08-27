import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'UI Sub Order'

let token = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  token = await adminToken(request)
  const auth = bearer(token)
  const meta = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers: auth })
  if (meta.status() === 404) {
    await request.post('/api/table_def', {
      headers: auth,
      data: {
        name: DT,
        is_submittable: true,
        columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', reqd: true }],
      },
    })
  }
})

test('UI-010: draft shows Submit; submitted shows Cancel + locks fields; cancelled shows Amend', async ({ page, request }) => {
  // fresh draft
  const created = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'action doc' },
  })
  const docName = ((await created.json()) as { row_id: string }).row_id

  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Draft: badge Draft, Submit button present, field editable
  await expect(page.getByTestId('status-badge')).toContainText('Draft')
  await expect(page.getByTestId('form-submit')).toBeVisible()
  await expect(page.locator('[data-field=title]')).toBeEnabled()

  // Submit -> Submitted, fields locked, Cancel present, Submit gone
  await page.getByTestId('form-submit').click()
  await expect(page.getByTestId('status-badge')).toContainText('Submitted')
  await expect(page.getByTestId('form-cancel')).toBeVisible()
  await expect(page.getByTestId('form-submit')).toHaveCount(0)
  await expect(page.locator('[data-field=title]')).toBeDisabled()

  // Cancel -> Cancelled, Amend present
  await page.getByTestId('form-cancel').click()
  await expect(page.getByTestId('status-badge')).toContainText('Cancelled')
  await expect(page.getByTestId('form-amend')).toBeVisible()

  // Amend -> navigates to a new draft (name-1) editable
  await page.getByTestId('form-amend').click()
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}/${docName}-1`))
  await expect(page.getByTestId('status-badge')).toContainText('Draft')
  await expect(page.locator('[data-field=title]')).toBeEnabled()
  await expect(page.locator('[data-field=title]')).toHaveValue('action doc')
})
