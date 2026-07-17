import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Attach DT'

// UI-023: Attach and Attach Image fields — upload, preview, clearing.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
        { fieldname: 'photo', fieldtype: 'Attach Image', label: 'Photo' },
        { fieldname: 'doc_file', fieldtype: 'Attach', label: 'Doc File' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)

  const created = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { title: 'attach fixture' },
  })
  if (created.status() !== 201) throw new Error(`doc: ${created.status()}`)
  docName = ((await created.json()) as { name: string }).name
})

test('UI-023: Attach Image uploads, previews, persists the URL, and clears', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('attach-btn-photo')).toBeVisible()

  // Upload an image: preview renders, field holds the file URL, form dirty.
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

  // Plain Attach uploads too: link but no preview.
  await page.locator('[data-attach-input=doc_file]').setInputFiles({
    name: 'spec.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('attach me'),
  })
  await expect(page.getByTestId('attach-link-doc_file')).toContainText('spec.txt')
  await expect(page.getByTestId('attach-preview-doc_file')).toHaveCount(0)

  // Save persists both values.
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  await page.reload()
  await expect(page.getByTestId('attach-preview-photo')).toBeVisible()
  await expect(page.getByTestId('attach-link-doc_file')).toContainText('spec.txt')

  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const stored = await page.request.get(
    `/api/resource/${encodeURIComponent(DT)}/${docName}`,
    { headers: auth },
  )
  const doc = (await stored.json()) as { photo: string; doc_file: string }
  expect(doc.photo).toMatch(/^\/files\//)
  expect(doc.doc_file).toMatch(/^\/files\//)

  // Clearing empties the value after save.
  await page.getByTestId('attach-clear-photo').click()
  await expect(page.getByTestId('attach-btn-photo')).toBeVisible()
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  const after = (await (
    await page.request.get(`/api/resource/${encodeURIComponent(DT)}/${docName}`, {
      headers: auth,
    })
  ).json()) as { photo: string | null; doc_file: string }
  expect(after.photo).toBeNull()
  expect(after.doc_file).toMatch(/^\/files\//)
})
