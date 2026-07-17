import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// FILE-002: attach two files to a document via the form sidebar; both are
// listed; deleting one removes its storage object too.

async function cleanup(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const filters = encodeURIComponent(
    JSON.stringify([
      ['ref_doctype', '=', 'User'],
      ['ref_name', '=', 'Guest'],
    ]),
  )
  const listed = (await (
    await request.get(`/api/resource/File?filters=${filters}`, { headers: auth })
  ).json()) as { data: { name: string }[] }
  for (const f of listed.data)
    await request.delete(`/api/resource/File/${f.name}`, { headers: auth })
}

test.beforeEach(async ({ request }) => cleanup(request))
test.afterEach(async ({ request }) => cleanup(request))

test('FILE-002: attach two files, both listed, delete one cleans up storage', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto('/desk/User/Guest')
  await expect(page.getByTestId('attachments-panel')).toBeVisible()
  await expect(page.getByTestId('attachments-panel')).toContainText('No attachments')

  // Attach two files.
  await page.getByTestId('attach-file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('first attachment'),
  })
  await expect(page.getByTestId('attachment-row')).toHaveCount(1)
  await page.getByTestId('attach-file-input').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  })
  await expect(page.getByTestId('attachment-row')).toHaveCount(2)
  await expect(page.getByTestId('attachments-panel')).toContainText('notes.txt')
  await expect(page.getByTestId('attachments-panel')).toContainText('photo.png')

  // The uploaded file is really served.
  const notesRow = page.getByTestId('attachment-row').filter({ hasText: 'notes.txt' })
  const fileUrl = await notesRow.locator('a').getAttribute('href')
  expect(fileUrl).toMatch(/^\/files\//)
  const served = await page.request.get(fileUrl!)
  expect(served.status()).toBe(200)
  expect(await served.text()).toBe('first attachment')

  // Delete it: row disappears and the storage object is gone (404).
  await notesRow.hover()
  await notesRow.getByTestId('attachment-delete').click()
  await expect(page.getByTestId('attachment-row')).toHaveCount(1)
  await expect(page.getByTestId('attachments-panel')).not.toContainText('notes.txt')
  const after = await page.request.get(fileUrl!)
  expect(after.status()).toBe(404)

  // The survivor still serves.
  const photoRow = page.getByTestId('attachment-row').filter({ hasText: 'photo.png' })
  const photoUrl = await photoRow.locator('a').getAttribute('href')
  expect((await page.request.get(photoUrl!)).status()).toBe(200)
})
