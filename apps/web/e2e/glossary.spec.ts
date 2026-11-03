import { test, expect, adminAuth } from './fixtures'

// A real document is needed: the glossary link scrolls to its hash target.
// jsdom neither scrolls nor implements Element.scrollIntoView.
test('in-place help opens its term in the glossary and closes the popover', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const table = 'Glossary browser journey'
  const made = await request.post('/api/table_def', {
    headers, data: { name: table, columns: [{ column_name: 'title', column_type: 'Data' }] },
  })
  expect(made.status()).toBe(201)
  const term = await request.post('/api/save_row', {
    headers,
    data: { table: 'Glossary Term', row: {
      term: 'Cycle count', definition: 'Count the stock on one shelf.', describes: [{ link_table: table }],
    } },
  })
  expect(term.status()).toBe(201)
  // Deep link only supplies the starting table; the glossary itself is
  // reached by its real help link, not a hand-built destination URL.
  await session.visit(`/featherbase/admin/${encodeURIComponent(table)}`)
    .clickButton('What is Cycle count?')
    .clickLink('Open in the glossary')
    .step('the glossary displays the chosen term at its hash target', async ({ page }) => {
      await expect(page).toHaveURL(/\/featherbase\/admin\/glossary#term-/)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1, name: 'Glossary' })).toBeVisible()
      const chosen = page.getByTestId('glossary-term').filter({ has: page.getByRole('heading', { name: 'Cycle count' }) })
      await expect(chosen).toContainText('Count the stock on one shelf.')
      await expect(chosen).toBeInViewport()
      expect(await chosen.getAttribute('id')).toBe(new URL(page.url()).hash.slice(1))
    })
})
