import { test, expect, adminToken } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #879: generic synthetic metadata, exercised through real navigation and reload.
const PARENT = 'BP Parent'
const RELATED = 'BP Related'
const CATEGORY = 'BP Category'
const enc = encodeURIComponent
const route = (table: string, row?: string) => `/featherbase/admin/${enc(table)}${row ? `/${enc(row)}` : ''}`

test.use({ viewport: { width: 1280, height: 800 } })

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  for (const table of [CATEGORY, RELATED, PARENT]) await deleteTableIfExists(request, token, table)
  const columns = [
    { column_name: 'code', column_type: 'Data', unique: true },
    { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
  ]
  for (const definition of [
    { name: PARENT, label: 'Parent Register', columns: [...columns, { column_name: 'enabled', column_type: 'Check', label: 'Enabled', in_list_view: true }] },
    { name: RELATED, label: 'Related Register', columns: [...columns, { column_name: 'venue', column_type: 'Reference', reference_table: PARENT }] },
    { name: CATEGORY, label: 'Category Register', columns: [...columns, { column_name: 'related', column_type: 'Reference', reference_table: RELATED }] },
  ]) {
    const made = await request.post('/api/table_def', {
      headers, data: { ...definition, id_pattern: 'field:code', title_column: 'title' },
    })
    expect(made.status(), `creating ${definition.name}`).toBe(201)
  }
  for (const [table, browse_presentation] of [
    [PARENT, { default_filters: [['enabled', '=', true]], preferred_related: { table: RELATED, column: 'venue' } }],
    [RELATED, { preferred_related: { table: CATEGORY, column: 'related' } }],
  ] as const) {
    const meta = await request.get(`/api/table/${enc(table)}:meta`, { headers })
    expect(meta.status()).toBe(200)
    const updated = await request.put(`/api/table_def/${enc(table)}`, {
      headers, data: { ...await meta.json(), browse_presentation },
    })
    expect(updated.status()).toBe(200)
  }
  for (const [table, row] of [
    [PARENT, { code: 'CURRENT', title: 'Current parent', enabled: true }],
    [PARENT, { code: 'RETIRED', title: 'Retired parent', enabled: false }],
    [RELATED, { code: 'FIRST', title: 'First related record', venue: 'CURRENT' }],
    [RELATED, { code: 'SECOND', title: 'Second related record', venue: 'CURRENT' }],
    [RELATED, { code: 'OTHER', title: 'Other parent record', venue: 'RETIRED' }],
    [CATEGORY, { code: 'ONE', title: 'First category', related: 'FIRST' }],
    [CATEGORY, { code: 'TWO', title: 'Second category', related: 'FIRST' }],
    [CATEGORY, { code: 'OUTSIDE', title: 'Other record category', related: 'SECOND' }],
  ] as const) {
    const made = await request.post('/api/save_row', { headers, data: { table, row } })
    expect(made.status(), `inserting ${table}/${row.code}`).toBe(201)
  }
})

test('#879: visible defaults and explicit all-rows URLs survive real navigation', async ({ session }) => {
  await session.visit(route(PARENT))
    .assertHas('[data-testid="filter-chip"]', { count: 1, text: 'Enabled = true' })
    .within('[data-testid="list-total"]', (total) => total.assertExactText('1 total'))
    .assertHas('[data-testid="list-rows"] tr', { count: 1, text: 'Current parent' })
  await session.reload()
    .assertHas('[data-testid="filter-chip"]', { count: 1 })
    .within('[data-testid="list-total"]', (total) => total.assertExactText('1 total'))
  await session.visit(`${route(PARENT)}?filters=${enc('[]')}`)
    .assertHas('[data-testid="filter-chip"]', { count: 0 })
    .within('[data-testid="list-total"]', (total) => total.assertExactText('2 total'))
    .assertHas('[data-testid="list-rows"] tr', { count: 2 })
    .assertHas('[data-testid="list-rows"]', { text: 'Retired parent' })
  await session.reload()
    .assertHas('[data-testid="filter-chip"]', { count: 0 })
    .within('[data-testid="list-total"]', (total) => total.assertExactText('2 total'))
})

test('#879: labelled navigation keeps canonical URLs and preferred related rows open inline', async ({ session }) => {
  await session.visit('/featherbase/admin/all-tables').assertHas('[data-testid="table-nav"]')
  await session.step('labelled table navigation opens the canonical table', async ({ page }) => {
    const link = page.getByTestId('table-nav').getByRole('link', { name: 'Parent Register', exact: true })
    expect(decodeURIComponent(await link.getAttribute('href') ?? '')).toMatch(new RegExp(`/admin/${PARENT}$`))
    await link.click()
    await expect(page.getByRole('heading', { name: 'Parent Register', exact: true })).toBeVisible()
    const row = page.getByTestId('list-rows').getByRole('link', { name: 'CURRENT', exact: true })
    expect(decodeURIComponent(await row.getAttribute('href') ?? '')).toMatch(new RegExp(`/admin/${PARENT}/CURRENT$`))
    await row.click()
    await expect(page.getByRole('heading', { name: 'Parent Register: Current parent', exact: true })).toBeVisible()
    const breadcrumb = page.getByTestId('breadcrumbs').getByRole('link', { name: 'Parent Register', exact: true })
    expect(decodeURIComponent(await breadcrumb.getAttribute('href') ?? '')).toMatch(new RegExp(`/admin/${PARENT}$`))
  })
  await session.step('only this parent’s two direct related records appear, with readable links', async ({ page }) => {
    const tab = page.getByTestId(`related-tab-${RELATED}`)
    await expect(tab).toHaveAttribute('aria-expanded', 'true')
    await expect(tab).toContainText('Related Register')
    const embedded = page.getByTestId('embedded-list')
    await expect(embedded.locator('tbody a')).toHaveCount(2)
    await expect(embedded.getByRole('link', { name: 'First related record', exact: true })).toBeVisible()
    await expect(embedded.getByRole('link', { name: 'Second related record', exact: true })).toBeVisible()
    await expect(embedded).not.toContainText('Other parent record')
    await tab.click()
    await expect(tab).toHaveAttribute('aria-expanded', 'false')
    await expect(embedded).toHaveCount(0)
    // Closing is local to this visit; the next full load uses metadata again.
  })
  await session.reload().assertHas('[data-testid="embedded-list"]')
  await session.step('a new visit reopens the default, then a related link opens its own categories', async ({ page }) => {
    const tab = page.getByTestId(`related-tab-${RELATED}`)
    await expect(tab).toHaveAttribute('aria-expanded', 'true')
    const link = page.getByTestId('embedded-list').getByRole('link', { name: 'First related record', exact: true })
    expect(decodeURIComponent(await link.getAttribute('href') ?? '')).toMatch(new RegExp(`/admin/${RELATED}/FIRST$`))
    await link.click()
    await expect(page.getByRole('heading', { name: 'Related Register: First related record', exact: true })).toBeVisible()
    await expect(page.getByTestId(`related-tab-${CATEGORY}`)).toHaveAttribute('aria-expanded', 'true')
    const embedded = page.getByTestId('embedded-list')
    await expect(embedded.locator('tbody a')).toHaveCount(2)
    await expect(embedded.getByRole('link', { name: 'First category', exact: true })).toBeVisible()
    await expect(embedded.getByRole('link', { name: 'Second category', exact: true })).toBeVisible()
    await expect(embedded).not.toContainText('Other record category')
  })
})
