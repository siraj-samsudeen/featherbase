import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

// FILE-002: attach two files to a document via the form sidebar; both are
// listed; deleting one removes its storage object too.

async function cleanup(request: APIRequestContext) {
  const token = await adminToken(request)
  const auth = bearer(token)
  const filters = encodeURIComponent(
    JSON.stringify([
      ['ref_table', '=', 'User'],
      ['ref_name', '=', 'Guest'],
    ]),
  )
  const listed = (await (
    await request.get(`/api/table/File?filters=${filters}`, { headers: auth })
  ).json()) as { data: { row_id: string }[] }
  for (const f of listed.data)
    await request.delete(`/api/table/File/${f.row_id}`, { headers: auth })
}

test.beforeEach(async ({ request }) => cleanup(request))
test.afterEach(async ({ request }) => cleanup(request))

test('FILE-002: attach two files, both listed, delete one cleans up storage', async ({
  page,
}) => {
  await page.goto('/admin/User/Guest')
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
