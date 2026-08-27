import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Sb DT'

// UI-017: form sidebar — assign a user, add a tag, attach a file; all persist
// and display on reload.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  docName = `sb-${Date.now()}`
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: docName, title: 'sidebar doc' } })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('UI-017: assignments, tags, and attachments persist across reload', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)

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
