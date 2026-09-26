import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Sb DT'

// UI-017: form sidebar — assign a user, add a tag, attach a file; all persist
// and display on reload. Migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md): every sidebar control is
// testid-addressed, so the interactions stay in named steps; assertHas
// covers the plain presence/text checks between them.

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

test('UI-017: assignments, tags, and attachments persist across reload', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`)

  await session.step('assign a user', async ({ page }) => {
    await page.getByTestId('assign-to').fill('Administrator')
    await page.getByTestId('assign-submit').click()
  })
  await session.assertHas('[data-testid="assignee"]', { text: 'Administrator' })

  await session.step('add a tag', async ({ page }) => {
    await page.getByTestId('tag-input').fill('urgent')
    await page.getByTestId('tag-add').click()
  })
  await session.assertHas('[data-testid="tag-chip"]', { text: 'urgent' })

  await session.step('attach a file', async ({ page }) => {
    await page.getByTestId('attach-file-input').setInputFiles({
      name: 'spec.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('sidebar attachment'),
    })
  })
  await session.assertHas('[data-testid="attachment-row"]', { text: 'spec.txt' })

  await session.step('reload — all three persist and display', async ({ page }) => {
    await page.reload()
    await expect(page.getByTestId('assignee')).toContainText('Administrator')
    await expect(page.getByTestId('tag-chip')).toContainText('urgent')
    await expect(page.getByTestId('attachment-row')).toContainText('spec.txt')
  })

  await session.step('removing a tag persists too', async ({ page }) => {
    await page.getByTestId('tag-chip').getByRole('button', { name: 'Remove urgent' }).click()
    await expect(page.getByTestId('tag-chip')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('tag-chip')).toHaveCount(0)
  })
})
