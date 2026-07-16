import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
// Unique-ish but stable name so re-runs are idempotent (delete first via API).
const NEW_DT = 'Builder Widget'

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  // Best-effort cleanup so the create path is exercised fresh each run.
  await request.fetch(`/api/doctype/${encodeURIComponent(NEW_DT)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {})
})

test('UI-011: create a DocType with 5 fields from the Desk; list+form work immediately', async ({ page, request }) => {
  // Clean any prior copy directly (no delete-DocType endpoint yet)
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const exists = await request.get(`/api/meta/${encodeURIComponent(NEW_DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  test.skip(exists.status() === 200, 'Builder Widget already exists in this DB; skipping create path')

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  // Enter the builder from the sidebar
  await page.getByTestId('new-doctype-link').click()
  await expect(page.getByTestId('doctype-builder')).toBeVisible()
  await page.getByTestId('dt-name').fill(NEW_DT)

  const fieldDefs = [
    ['title', 'Title', 'Data', '', true, true],
    ['count', 'Count', 'Int', '', false, true],
    ['active', 'Active', 'Check', '', false, false],
    ['stage', 'Stage', 'Select', 'New, Done', false, true],
    ['notes', 'Notes', 'Text', '', false, false],
  ] as const

  for (let i = 0; i < fieldDefs.length; i++) {
    if (i > 0) await page.getByTestId('dt-add-field').click()
    const [fn, label, type, options, reqd, list] = fieldDefs[i]
    const row = page.getByTestId('dt-fields').locator('tbody tr').nth(i)
    await row.locator('[data-rowfield=fieldname]').fill(fn)
    await row.locator('[data-rowfield=label]').fill(label)
    await row.locator('[data-rowfield=fieldtype]').selectOption(type)
    if (options) await row.locator('[data-rowfield=options]').fill(options)
    if (reqd) await row.locator('[data-rowfield=reqd]').check()
    if (list) await row.locator('[data-rowfield=in_list_view]').check()
  }

  await page.getByTestId('dt-create').click()
  // Lands on the new DocType's (empty) list view
  await expect(page).toHaveURL(new RegExp(`/desk/Builder%20Widget`))
  await expect(page.getByTestId('list-view')).toBeVisible()
  await expect(page.getByTestId('col-title')).toContainText('Title')

  // Form view works immediately: create a document
  await page.goto(`/desk/${encodeURIComponent(NEW_DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('[data-field=title]').fill('first doc')
  await page.locator('select[data-field=stage]').selectOption('Done')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-status')).toContainText('Saved')

  // It appears in the list
  await page.goto(`/desk/${encodeURIComponent(NEW_DT)}`)
  await expect(page.getByTestId('list-rows')).toContainText('first doc')

  // And the metadata is real (server side)
  const meta = await request.get(`/api/meta/${encodeURIComponent(NEW_DT)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await meta.json()) as { fields: { fieldname: string }[] }
  expect(body.fields.map((f) => f.fieldname)).toEqual(
    expect.arrayContaining(['title', 'count', 'active', 'stage', 'notes']),
  )
})
