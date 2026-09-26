import { test, expect, adminAuth } from './fixtures'
import { createFormRow, ensureFormTables, ensureTable, FORM_DT as DT } from './fixtures-ui'

const SEC_DT = 'UI Section DT'

let auth: { Authorization: string }
let docName = ''

test.beforeAll(async ({ request }) => {
  auth = await adminAuth(request)

  // Owns the FormView Tables rather than borrowing formview.spec's; the
  // shared builder in ./fixtures-ui keeps the shapes identical and
  // idempotent whichever spec runs first.
  await ensureFormTables(request, auth)
  docName = await createFormRow(request, auth, {
    title: 'grid fixture',
    items: [{ item: 'one', qty: 1 }, { item: 'two', qty: 2 }, { item: 'three', qty: 3 }],
  })

  await ensureTable(request, auth, {
    name: SEC_DT,
    columns: [
      { column_name: 'a1', column_type: 'Data', label: 'A One' },
      { column_name: 'a2', column_type: 'Data', label: 'A Two' },
      { column_name: 'sec_b', column_type: 'Section Break', label: 'Details' },
      { column_name: 'b1', column_type: 'Data', label: 'B One' },
      { column_name: 'col_b', column_type: 'Column Break' },
      { column_name: 'b2', column_type: 'Data', label: 'B Two' },
    ],
  })
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The child grid's rows/cells are testid- and data-childfield-addressed, not
// labelled controls, so the round trip stays inside named steps;
// `session.visit`/`assertHas` carry navigation and the plain checks around it.
test('UI-007: child grid add/edit/delete/reorder round-trips through save', async ({ session, request }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
    .assertHas('[data-testid="table-items"] tbody tr', { count: 3 })

  await session.step('edit, delete, add and reorder rows in the child grid', async ({ page }) => {
    const grid = page.getByTestId('table-items')
    // Edit row 2's qty
    await grid.locator('tbody tr').nth(1).locator('[data-childfield=qty]').fill('22')
    // Delete row 3
    await grid.locator('tbody tr').nth(2).getByRole('button', { name: 'Remove row' }).click()
    await expect(grid.locator('tbody tr')).toHaveCount(2)
    // Add a new row
    await page.getByTestId('add-row-items').click()
    await grid.locator('tbody tr').nth(2).locator('[data-childfield=item]').fill('added')
    await grid.locator('tbody tr').nth(2).locator('[data-childfield=qty]').fill('9')
    // Move the new row up (added, position 3 -> 2)
    await grid.locator('tbody tr').nth(2).getByRole('button', { name: 'Move row up' }).click()
    await expect(grid.locator('tbody tr').nth(1).locator('[data-childfield=item]')).toHaveValue('added')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })

  // DB reflects content and order exactly
  const res = await request.get(`/api/table/${encodeURIComponent(DT)}/${docName}`, { headers: auth })
  const doc = (await res.json()) as { items: { item: string; qty: string; position: number }[] }
  expect(doc.items.map((r) => [r.item, Number(r.qty), r.position])).toEqual([
    ['one', 1, 1],
    ['added', 9, 2],
    ['two', 22, 3],
  ])
})

test('UI-008: Section and Column Breaks produce grouped sections in metadata order', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(SEC_DT)}`)
  await session.step('open a fresh form and inspect its two sections', async ({ page }) => {
    await page.getByTestId('list-new').click()
    await expect(page.getByTestId('form-view')).toBeVisible()

    // Two sections: 0 has a1+a2, 1 has b1+b2 (with a column break between)
    const s0 = page.getByTestId('form-section-0')
    const s1 = page.getByTestId('form-section-1')
    await expect(s0.locator('[data-field=a1]')).toBeVisible()
    await expect(s0.locator('[data-field=a2]')).toBeVisible()
    await expect(s0.locator('[data-field=b1]')).toHaveCount(0)
    await expect(s1.locator('[data-field=b1]')).toBeVisible()
    await expect(s1.locator('[data-field=b2]')).toBeVisible()
  })
})

test('UI-016: breadcrumbs navigate and the title bar tracks saved state', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
    .assertHas('[data-testid="breadcrumbs"]', { text: 'Admin' })
    .assertHas('[data-testid="breadcrumbs"]', { text: DT })
    .assertHas('[data-testid="breadcrumbs"]', { text: docName })
    .assertHas('[data-testid="form-status"]', { text: 'Saved' })

  await session.step('edit the title field directly', async ({ page }) => {
    await page.locator('[data-field=title]').fill('status probe')
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Not saved' })
  await session.step('save the edit', async ({ page }) => {
    await page.getByTestId('form-save').click()
  })
  await session
    .assertHas('[data-testid="form-banner"]', { text: 'Saved' })
    .assertHas('[data-testid="form-status"]', { text: 'Saved' })

  // Breadcrumb table link returns to the list
  await session.step('click the Table breadcrumb back to the list', async ({ page }) => {
    await page.getByTestId('breadcrumbs').getByText(DT).click()
  })
  await session.assertHas('[data-testid="list-view"]')
})
