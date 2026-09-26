import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

// FILE-002: attach two files to a document via the form sidebar; both are
// listed; deleting one removes its storage object too.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// file inputs, `href`/served-content checks, and hover-then-delete all stay
// in named steps; assertHas covers the plain presence/text checks.

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
  session,
}) => {
  await session
    .visit('/admin/User/Guest')
    .assertHas('[data-testid="attachments-panel"]')
    .assertHas('[data-testid="attachments-panel"]', { text: 'No attachments' })

  await session.step('attach two files', async ({ page }) => {
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
  })

  let fileUrl = ''
  await session.step('the uploaded file is really served', async ({ page }) => {
    const notesRow = page.getByTestId('attachment-row').filter({ hasText: 'notes.txt' })
    fileUrl = (await notesRow.locator('a').getAttribute('href'))!
    expect(fileUrl).toMatch(/^\/files\//)
    const served = await page.request.get(fileUrl)
    expect(served.status()).toBe(200)
    expect(await served.text()).toBe('first attachment')
  })

  await session.step('delete it: row disappears and the storage object 404s', async ({ page }) => {
    const notesRow = page.getByTestId('attachment-row').filter({ hasText: 'notes.txt' })
    await notesRow.hover()
    await notesRow.getByTestId('attachment-delete').click()
    await expect(page.getByTestId('attachment-row')).toHaveCount(1)
    await expect(page.getByTestId('attachments-panel')).not.toContainText('notes.txt')
    const after = await page.request.get(fileUrl)
    expect(after.status()).toBe(404)
  })

  await session.step('the survivor still serves', async ({ page }) => {
    const photoRow = page.getByTestId('attachment-row').filter({ hasText: 'photo.png' })
    const photoUrl = await photoRow.locator('a').getAttribute('href')
    expect((await page.request.get(photoUrl!)).status()).toBe(200)
  })
})
