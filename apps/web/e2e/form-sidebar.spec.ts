import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Sb DT'

// UI-017: form sidebar — assign a user, add a tag, attach a file; all persist
// and display on reload.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = `sb-${Date.now()}`
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { name: docName, title: 'sidebar doc' } })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('UI-017: assignments, tags, and attachments persist across reload', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)

  // Assign a user.
  await page.getByTestId('assign-to').fill('Administrator')
  await page.getByTestId('assign-submit').click()
  await expect(page.getByTestId('assignee')).toContainText('Administrator')

  // Add a tag.
  await page.getByTestId('tag-input').fill('urgent')
  await page.getByTestId('tag-add').click()
  await expect(page.getByTestId('tag-chip')).toContainText('urgent')

  // Attach a file.
  await page.getByTestId('attach-file-input').setInputFiles({
    name: 'spec.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('sidebar attachment'),
  })
  await expect(page.getByTestId('attachment-row')).toContainText('spec.txt')

  // Reload — all three persist and display.
  await page.reload()
  await expect(page.getByTestId('assignee')).toContainText('Administrator')
  await expect(page.getByTestId('tag-chip')).toContainText('urgent')
  await expect(page.getByTestId('attachment-row')).toContainText('spec.txt')

  // Removing a tag persists too.
  await page.getByTestId('tag-chip').getByRole('button', { name: 'Remove urgent' }).click()
  await expect(page.getByTestId('tag-chip')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('tag-chip')).toHaveCount(0)
})
