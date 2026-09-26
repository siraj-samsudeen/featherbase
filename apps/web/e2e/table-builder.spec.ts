import { test, expect, adminToken } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// Unique-ish but stable name so re-runs are idempotent (delete first via API).
const NEW_DT = 'Builder Widget'

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request)
  // Pre-clean leftovers so the create path is exercised fresh each run.
  await deleteTableIfExists(request, token, NEW_DT)
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The Table Builder's grid rows and buttons are testid-addressed, not
// labelled or named controls the DSL's click/fillIn verbs can reach, so the
// build itself stays inside named steps; `session.visit`/`assertPath`/
// `assertHas` carry the navigation and plain checks around it.
test('UI-011: create a Table with 5 fields from the Admin; list+form work immediately', async ({
  session,
  request,
}) => {
  // Clean any prior copy directly (no delete-Table endpoint yet)
  const token = await adminToken(request)
  const exists = await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  test.skip(exists.status() === 200, 'Builder Widget already exists in this DB; skipping create path')

  await session.visit('/admin')
  await session.step('open the builder from the sidebar and name the Table', async ({ page }) => {
    await page.getByTestId('new-table-link').click()
    await expect(page.getByTestId('table-builder')).toBeVisible()
    await page.getByTestId('dt-name').fill(NEW_DT)
  })

  await session.step('NAM-002: the row id is column one, locked above the editable rows', async ({ page }) => {
    const grid = page.getByTestId('dt-fields')
    await expect(grid.locator('tbody tr').first()).toHaveAttribute('data-testid', 'dt-row-id')
    await expect(grid.getByTestId('dt-row-id')).not.toHaveAttribute('data-columnrow', '')
  })

  await session.step('declare five fields of every kind the grid supports', async ({ page }) => {
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
  })

  // Lands on the new Table's (empty) list view
  await session
    .assertPath(`/featherbase/admin/${encodeURIComponent(NEW_DT)}`)
    .assertHas('[data-testid="list-view"]')
    .assertHas('[data-testid="col-title"]', { text: 'Title' })

  // #80: the table auto-appears on its module's home page WITHOUT a reload —
  // the Custom page shows up in the sidebar and carries the table's link.
  await session.assertHas('[data-testid="home-page-link-custom"]')
  await session.step('reach the Table again through the Custom home page', async ({ page }) => {
    await page.getByTestId('home-page-link-custom').click()
    await expect(page.getByTestId('home-page-title')).toHaveText('Custom')
    await expect(page.getByTestId(`home-link-${NEW_DT}`)).toBeVisible()
    await page.getByTestId(`home-link-${NEW_DT}`).click()
  })
  await session
    .assertPath(`/featherbase/admin/${encodeURIComponent(NEW_DT)}`)
    .assertHas('[data-testid="list-view"]')

  // Form view works immediately: create a document
  await session.step('create a document through the fresh form', async ({ page }) => {
    await page.getByTestId('list-new').click()
    await expect(page.getByTestId('form-view')).toBeVisible()
    await page.locator('[data-field=title]').fill('first doc')
    await page.locator('select[data-field=stage]').selectOption('Done')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Saved' })

  // It appears in the list
  await session
    .visit(`/admin/${encodeURIComponent(NEW_DT)}`)
    .assertHas('[data-testid="list-rows"]', { text: 'first doc' })

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
test('#128: a blank row above a bad column does not shift the blame', async ({ session }) => {
  await session.visit('/admin')
  await session.step('open the builder and name a Table that never gets created', async ({ page }) => {
    await page.getByTestId('new-table-link').click()
    await expect(page.getByTestId('table-builder')).toBeVisible()
    // Never created: the definition is refused at validation, before any DDL.
    await page.getByTestId('dt-name').fill('Offset Probe')
  })

  await session.step('leave row 0 blank, declare row 1, submit', async ({ page }) => {
    const rows = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
    // Row 0 stays blank — the user cleared its name. It is dropped from the
    // payload, so every server index below counts from row 1.
    await page.getByTestId('dt-add-field').click()
    const bad = rows.nth(1)
    await bad.locator('[data-rowfield=column_name]').fill('Bad Name')
    await bad.locator('[data-rowfield=label]').fill('Price')
    await page.getByTestId('dt-create').click()
  })

  await session.step('the banner names the column, announces itself, and leaks no index path', async ({ page }) => {
    const banner = page.getByTestId('dt-error')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText('Price')
    await expect(banner).toContainText('snake_case')
    await expect(banner).not.toContainText('columns.0')
    await expect(banner).not.toContainText('columns.1')
  })

  await session.step('the mark lands on row 1, never on the blank row 0', async ({ page }) => {
    await expect(page.getByTestId('dt-col-error-1')).toBeVisible()
    await expect(page.getByTestId('dt-col-error-0')).toHaveCount(0)

    // The offending input is described by its error and holds focus, so a
    // screen-reader user is taken to the fault instead of hunting for it.
    const rows = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
    const badInput = rows.nth(1).locator('[data-rowfield=column_name]')
    await expect(badInput).toHaveAttribute('aria-invalid', 'true')
    await expect(badInput).toHaveAttribute('aria-describedby', 'dt-col-error-1')
    await expect(badInput).toBeFocused()
    await expect(rows.nth(0).locator('[data-rowfield=column_name]')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  await session.step('the accusation dies with the correction, not at the next submit', async ({ page }) => {
    const rows = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
    await rows.nth(1).locator('[data-rowfield=column_name]').fill('price')
    await expect(page.getByTestId('dt-col-error-1')).toHaveCount(0)
    await expect(page.getByTestId('dt-error')).toHaveCount(0)
  })
})
