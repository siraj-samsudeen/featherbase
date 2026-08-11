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

test('UI-011: create a DocType with 5 fields from the Admin; list+form work immediately', async ({ page, request }) => {
  // Clean any prior copy directly (no delete-DocType endpoint yet)
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const exists = await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  test.skip(exists.status() === 200, 'Builder Widget already exists in this DB; skipping create path')

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  // Enter the builder from the sidebar
  await page.getByTestId('new-doctype-link').click()
  await expect(page.getByTestId('doctype-builder')).toBeVisible()
  await page.getByTestId('dt-name').fill(NEW_DT)

  // NAM-002 contract: the row id is column one — a locked row above the
  // editable column rows. Pinned here because when it was introduced the
  // specs silently read the wrong rows instead of failing (#94); every
  // column assertion below selects [data-columnrow], never a bare tbody tr.
  const grid = page.getByTestId('dt-fields')
  await expect(grid.locator('tbody tr').first()).toHaveAttribute('data-testid', 'dt-row-id')
  await expect(grid.getByTestId('dt-row-id')).not.toHaveAttribute('data-columnrow', '')

  const fieldDefs = [
    ['title', 'Title', 'Data', '', true, true],
    ['count', 'Count', 'Int', '', false, true],
    ['active', 'Active', 'Check', '', false, false],
    ['stage', 'Stage', 'Choice', 'New, Done', false, true],
    ['notes', 'Notes', 'Text', '', false, false],
  ] as const

  for (let i = 0; i < fieldDefs.length; i++) {
    if (i > 0) await page.getByTestId('dt-add-field').click()
    const [fn, label, type, target, reqd, list] = fieldDefs[i]
    const row = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]').nth(i)
    await row.locator('[data-rowfield=column_name]').fill(fn)
    await row.locator('[data-rowfield=label]').fill(label)
    await row.locator('[data-rowfield=column_type]').selectOption(type)
    if (target) await row.locator('[data-rowfield=target]').fill(target)
    if (reqd) await row.locator('[data-rowfield=reqd]').check()
    if (list) await row.locator('[data-rowfield=in_list_view]').check()
  }

  await page.getByTestId('dt-create').click()
  // Lands on the new DocType's (empty) list view
  await expect(page).toHaveURL(new RegExp(`/admin/Builder%20Widget`))
  await expect(page.getByTestId('list-view')).toBeVisible()
  await expect(page.getByTestId('col-title')).toContainText('Title')

  // #80: the table auto-appears on its module's home page WITHOUT a reload —
  // the Custom page shows up in the sidebar and carries the table's link.
  await expect(page.getByTestId('home-page-link-custom')).toBeVisible()
  await page.getByTestId('home-page-link-custom').click()
  await expect(page.getByTestId('home-page-title')).toHaveText('Custom')
  await expect(page.getByTestId(`home-link-${NEW_DT}`)).toBeVisible()
  await page.getByTestId(`home-link-${NEW_DT}`).click()
  await expect(page).toHaveURL(new RegExp(`/admin/Builder%20Widget`))
  await expect(page.getByTestId('list-view')).toBeVisible()

  // Form view works immediately: create a document
  await page.goto(`/admin/${encodeURIComponent(NEW_DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('[data-field=title]').fill('first doc')
  await page.locator('select[data-field=stage]').selectOption('Done')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-status')).toContainText('Saved')

  // It appears in the list
  await page.goto(`/admin/${encodeURIComponent(NEW_DT)}`)
  await expect(page.getByTestId('list-rows')).toContainText('first doc')

  // And the metadata is real (server side)
  const meta = await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await meta.json()) as {
    module: string
    system: boolean
    columns: { column_name: string }[]
  }
  expect(body.columns.map((f) => f.column_name)).toEqual(
    expect.arrayContaining(['title', 'count', 'active', 'stage', 'notes']),
  )
  // #74: the builder sends a real module (default "Custom") and a user-built
  // table is never a system table — it files into the sidebar's user section.
  expect(body.module).toBe('Custom')
  expect(body.system).toBe(false)
})

// #128: a rejected create must accuse the column the user is looking at.
// The payload drops blank-named rows, so the server's `columns.0` is the
// SECOND row on screen — the same off-by-a-blank-row class of bug #115 fixed
// for imported rows. A blank row above a bad column is the witness.
test('#128: a blank row above a bad column does not shift the blame', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  await page.getByTestId('new-doctype-link').click()
  await expect(page.getByTestId('doctype-builder')).toBeVisible()
  // Never created: the definition is refused at validation, before any DDL.
  await page.getByTestId('dt-name').fill('Offset Probe')

  const rows = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
  // Row 0 stays blank — the user cleared its name. It is dropped from the
  // payload, so every server index below counts from row 1.
  await page.getByTestId('dt-add-field').click()
  const bad = rows.nth(1)
  await bad.locator('[data-rowfield=column_name]').fill('Bad Name')
  await bad.locator('[data-rowfield=label]').fill('Price')

  await page.getByTestId('dt-create').click()

  // The banner names the column, announces itself, and leaks no index path.
  const banner = page.getByTestId('dt-error')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toContainText('Price')
  await expect(banner).toContainText('snake_case')
  await expect(banner).not.toContainText('columns.0')
  await expect(banner).not.toContainText('columns.1')

  // The mark lands on row 1 — the bad column — and never on the blank row 0.
  await expect(page.getByTestId('dt-col-error-1')).toBeVisible()
  await expect(page.getByTestId('dt-col-error-0')).toHaveCount(0)

  // The offending input is described by its error and holds focus, so a
  // screen-reader user is taken to the fault instead of hunting for it.
  const badInput = bad.locator('[data-rowfield=column_name]')
  await expect(badInput).toHaveAttribute('aria-invalid', 'true')
  await expect(badInput).toHaveAttribute('aria-describedby', 'dt-col-error-1')
  await expect(badInput).toBeFocused()
  await expect(rows.nth(0).locator('[data-rowfield=column_name]')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  )

  // The accusation dies with the correction, not at the next submit.
  await badInput.fill('price')
  await expect(page.getByTestId('dt-col-error-1')).toHaveCount(0)
  await expect(banner).toHaveCount(0)
})
