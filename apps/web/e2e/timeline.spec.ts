import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Tl DT'

// UI-019: after an edit and a comment, the timeline shows both in order with
// the diff summary.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // Fresh doc name per run so accumulated versions/comments from prior runs
  // don't skew the exact-count assertions.
  docName = `tl-doc-${Math.random().toString(36).slice(2, 8)}`
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: docName, title: 'original' },
  })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// the field edit is a `[data-field=...]` control with no label, and the
// ordering check evaluates DOM attributes directly, so the whole edit +
// comment round trip stays in one named step; session.visit carries the
// plain navigation.
test('UI-019: timeline interleaves an edit (with diff) and a comment in order', async ({
  session,
}) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await session.step('an edit (with diff) and a comment both land in chronological order', async ({ page }) => {
    await expect(page.getByTestId('activity-timeline')).toBeVisible()

    // Edit the title → produces a version with a diff.
    await page.locator('[data-field=title]').fill('revised title')
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-banner')).toContainText('Saved')
    await expect(page.getByTestId('activity-version')).toHaveCount(1)
    await expect(page.getByTestId('activity-diff')).toContainText('title')
    await expect(page.getByTestId('activity-diff')).toContainText('original')
    await expect(page.getByTestId('activity-diff')).toContainText('revised title')

    // Post a comment → appears after the edit (later timestamp).
    await page.getByTestId('comment-input').fill('looks good now')
    await page.getByTestId('comment-submit').click()
    await expect(page.getByTestId('activity-comment')).toHaveCount(1)

    // Both present, in chronological order (version before comment).
    const kinds = await page
      .getByTestId('activity-timeline')
      .locator('[data-testid^="activity-version"], [data-testid^="activity-comment"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    expect(kinds).toEqual(['activity-version', 'activity-comment'])
  })
})
