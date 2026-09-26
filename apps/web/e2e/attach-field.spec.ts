import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'UI Attach DT'

// UI-023: Attach and Attach Image fields — upload, preview, clearing.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// file inputs, attribute reads (`src`, natural size) and localStorage-token
// verification aren't expressible by DSL verbs, so the whole round trip stays
// in named steps.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)

  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Title' },
        { column_name: 'photo', column_type: 'Attach Image', label: 'Photo' },
        { column_name: 'doc_file', column_type: 'Attach', label: 'Doc File' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)

  const created = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { title: 'attach fixture' },
  })
  if (created.status() !== 201) throw new Error(`doc: ${created.status()}`)
  docName = ((await created.json()) as { row_id: string }).row_id
})

test('UI-023: Attach Image uploads, previews, persists the URL, and clears', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
    .assertHas('[data-testid="attach-btn-photo"]')

  await session.step(
    'upload an image: preview renders, field holds the file URL, form dirty',
    async ({ page }) => {
      await page.locator('[data-attach-input=photo]').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      const preview = page.getByTestId('attach-preview-photo')
      await expect(preview).toBeVisible()
      const src = await preview.getAttribute('src')
      expect(src).toMatch(/^\/files\/[0-9a-f]{16}_avatar\.png$/)
      await expect(page.getByTestId('form-status')).toContainText('Not saved')

      // The preview image actually loads (natural size > 0).
      const loaded = await preview.evaluate((el) => (el as HTMLImageElement).naturalWidth)
      expect(loaded).toBeGreaterThan(0)
    },
  )

  await session.step('plain Attach uploads too: link but no preview', async ({ page }) => {
    await page.locator('[data-attach-input=doc_file]').setInputFiles({
      name: 'spec.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('attach me'),
    })
    await expect(page.getByTestId('attach-link-doc_file')).toContainText('spec.txt')
    await expect(page.getByTestId('attach-preview-doc_file')).toHaveCount(0)
  })

  await session.step('save persists both values; a reload keeps them', async ({ page }) => {
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-banner')).toContainText('Saved')
    await page.reload()
    await expect(page.getByTestId('attach-preview-photo')).toBeVisible()
    await expect(page.getByTestId('attach-link-doc_file')).toContainText('spec.txt')
  })

  await session.step('the DB reflects both values as file URLs', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const auth = { Authorization: `Bearer ${token}` }
    const stored = await page.request.get(`/api/table/${encodeURIComponent(DT)}/${docName}`, {
      headers: auth,
    })
    const doc = (await stored.json()) as { photo: string; doc_file: string }
    expect(doc.photo).toMatch(/^\/files\//)
    expect(doc.doc_file).toMatch(/^\/files\//)
  })

  await session.step('clearing empties the value after save', async ({ page }) => {
    await page.getByTestId('attach-clear-photo').click()
    await expect(page.getByTestId('attach-btn-photo')).toBeVisible()
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-banner')).toContainText('Saved')
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const auth = { Authorization: `Bearer ${token}` }
    const after = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}/${docName}`, { headers: auth })
    ).json()) as { photo: string | null; doc_file: string }
    expect(after.photo).toBeNull()
    expect(after.doc_file).toMatch(/^\/files\//)
  })
})
