import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Ps Ui Target'

// CUST-002: override a field label; the form shows the new label; the base
// definition is unchanged (restored when the setter is removed).

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.delete(`/api/table/${encodeURIComponent(DT)}/ps-doc`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: 'ps-doc', title: 'hi' },
  })
  // Clean any prior setter.
  await request.delete(`/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-label`)}`, { headers })
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// the checks target a bare `<label>` by text rather than a labelled control
// (there's nothing to fill/select — the label text itself is the subject),
// which assertHas/assertText can't address, so each round trip stays a
// named step; session.visit carries the one plain navigation.
test('CUST-002: a label override shows in the form and reverts when removed', async ({ session, request }) => {
  const headers = await adminAuth(request)

  await session.visit(`/admin/${encodeURIComponent(DT)}/ps-doc`)
  await session.step('base label reads "Title"', async ({ page }) => {
    await expect(page.locator('label', { hasText: 'Title' }).first()).toBeVisible()
  })

  // Add a Property Setter via the API (Customize-Form mechanism).
  const ps = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Metadata Override',
      row: { row_id: `${DT}-title-label`, table_name: DT, column_name: 'title', property: 'label', value: 'Headline' },
    },
  })
  expect([200, 201]).toContain(ps.status())

  await session.step('reload: the form shows the overridden label', async ({ page }) => {
    await page.reload()
    await expect(page.locator('label', { hasText: 'Headline' }).first()).toBeVisible()
  })

  // Base docfield unchanged: removing the setter reverts the label.
  await request.delete(`/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-label`)}`, { headers })
  await session.step('removing the setter reverts to the base label on reload', async ({ page }) => {
    await page.reload()
    await expect(page.locator('label', { hasText: 'Title' }).first()).toBeVisible()
    await expect(page.locator('label', { hasText: 'Headline' })).toHaveCount(0)
  })
})
