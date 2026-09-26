import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { test, expect, adminAuth, type Page } from './fixtures'
import { ensureFormFixtures, ensureTable, FORM_DT } from './fixtures-ui'

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })

async function capture(page: Page, name: string) {
  const dir = process.env.UI_EVIDENCE_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true })
}

test('Table collision describes four destinations without changing Enter precedence', async ({ page }) => {
  await page.goto('/admin')
  const input = page.getByTestId('awesomebar').locator('input')
  await input.fill('Table')
  for (const kind of ['commands', 'tables', 'create', 'records'])
    await expect(page.getByTestId(`awesomebar-${kind}-heading`)).toBeVisible()
  await expect(page.getByTestId('awesomebar-cmd-new-table')).toHaveText('› New Table')
  await expect(page.getByTestId('awesomebar-table').filter({ hasText: /^TableCore module/ })).toHaveCount(1)
  await expect(page.getByTestId('awesomebar-new').filter({ hasText: 'New Table row' })).toHaveCount(1)
  await expect(page.getByTestId('awesomebar-doc').filter({ hasText: /row in Table/ }).first()).toBeVisible()
  await capture(page, 'awesomebar-destinations')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/admin\/Table$/)
  await expect(page.getByTestId('list-view')).toBeVisible()
})

function workbook(names: string[]) {
  const wb = XLSX.utils.book_new()
  for (const [i, name] of names.entries())
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Count'], [name, i + 7]]), name)
  return { name: 'zones.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer }
}

test('multi-sheet warning names omissions next to the drop and disappears on replacement or clear', async ({ page }) => {
  await page.goto('/admin/new-table')
  await page.getByTestId('dt-file-input').setInputFiles(workbook(['Zones', 'Stores', 'Prices']))
  const warning = page.getByTestId('dt-more-sheets')
  await expect(warning).toHaveText('Only “Zones” will be imported. Ignored sheets: “Stores”, “Prices”. Use the Import wizard to import all 3 sheets.')
  await expect(warning).toHaveAttribute('role', 'status')
  expect(await page.getByTestId('dt-dropzone').evaluate((el) => el.nextElementSibling?.getAttribute('data-testid'))).toBe('dt-more-sheets')
  await expect(page.getByTestId('dt-preview')).toContainText('Zones')
  await expect(page.getByTestId('dt-preview')).not.toContainText('Stores')
  await expect(warning.getByRole('link', { name: 'Import wizard' })).toHaveAttribute('href', /\/admin\/import/)
  await capture(page, 'builder-multi-sheet-warning')
  await page.getByTestId('dt-file-input').setInputFiles(workbook(['Solo']))
  await expect(warning).toHaveCount(0)
  await page.getByTestId('dt-file-input').setInputFiles(workbook(['North', 'South']))
  await expect(warning).toContainText('“South”')
  await expect(warning).not.toContainText('Stores')
  await page.getByTestId('dt-clear-file').click()
  await expect(warning).toHaveCount(0)
})

test('source preview distinguishes bound, selected, wrong-schema and wrong-key FK proposals', async ({ page }) => {
  const col = (name: string, references: { schema: string; table: string; column: string } | null = null, reference_table: string | null = null) =>
    ({ name, data_type: 'integer', column_type: 'Int', is_pk: name === 'id', references, reference_table })
  const target = (schema: string, table: string, reflected: string | null = null) =>
    ({ schema, table, pk: 'id', bindable: true, proposed_name: `Next ${table}`, already_reflected: reflected, columns: [col('id'), col('count')] })
  const edge = (table: string, column = 'id', schema = 'public') => ({ schema, table, column })
  const tables = [
    { ...target('public', 'orders'), columns: [col('id', edge('customers')), col('customer_id', edge('customers')), col('archive_id', edge('customers', 'id', 'archive')), col('code', edge('customers', 'code')), col('warehouse_id', edge('warehouses'), 'Warehouse'), col('legacy_id', edge('legacy')), col('amount')] },
    target('public', 'customers'), target('archive', 'customers'),
    target('public', 'warehouses', 'Warehouse'), target('public', 'legacy', 'Legacy Latest'),
  ]
  let failLoad = false
  await page.route('**/api/table/Data%20Source/preview:introspect*', (route) => failLoad
    ? route.fulfill({ status: 500, json: { error: { type: 'TestFailure', message: 'Preview unavailable' } } })
    : route.fulfill({ json: { source: 'preview', engine: 'postgres', access: 'read_only', tables } }))
  let writes = 0
  page.on('request', (request) => { if (request.url().includes(':reflect')) writes++ })
  await page.goto('/admin/source/preview')
  await page.getByTestId('sb-load').click()
  await page.getByTestId('sb-row-orders').locator('summary').click()
  const preview = page.getByRole('list', { name: 'Columns of public.orders' })
  const field = (name: string) => preview.getByRole('listitem').filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${name}$`) }) })
  await expect(field('warehouse_id')).toContainText('Reference → Warehouse')
  await expect(field('customer_id')).toContainText('Reference requires')
  await page.getByLabel('Reflect public.customers', { exact: true }).check()
  await expect(field('customer_id')).toContainText('Reference → Next customers')
  await expect(field('archive_id')).not.toContainText('Reference →')
  await expect(field('archive_id')).toContainText('archive.customers.id')
  await expect(field('code')).not.toContainText('Reference →')
  await expect(field('code')).toContainText('public.customers.code')
  await expect(field('legacy_id')).not.toContainText('Reference →')
  await expect(field('amount')).toHaveText('amount (integer) → Int')
  await expect(field('id')).toContainText('Row ID')
  await capture(page, 'source-reference-proposals')
  await page.getByLabel('Reflect public.customers', { exact: true }).uncheck()
  await expect(field('customer_id')).not.toContainText('Reference →')
  expect(writes).toBe(0)
  failLoad = true
  await page.getByTestId('sb-load').click()
  await expect(page.getByText('Preview unavailable')).toBeVisible({ timeout: 12000 })
  await expect(preview).toHaveCount(0)
  await capture(page, 'source-preview-error')
})

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const v = parseInt(channel, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

test('all palette/mode text roles meet AA, and existing text utilities resolve to the new roles', async ({ page }) => {
  const who = page.waitForResponse((r) => r.url().endsWith('/api/whoami'))
  await page.goto('/admin/new-table')
  await expect(page.getByTestId('session-user')).toBeVisible()
  // Wait for server preferences before selecting the purely visual matrix.
  await who
  for (const palette of ['classic', 'ivory', 'graphite', 'indigo']) {
    for (const theme of ['light', 'dark']) {
      const result = await page.evaluate(({ palette, theme }) => {
        const root = document.documentElement
        root.dataset.palette = palette
        root.dataset.theme = theme
        const style = getComputedStyle(root)
        const tokens = Object.fromEntries(['link', 'good-text', 'danger-text', 'warn-text', 'canvas', 'surface', 'subtle', 'brand-tint', 'good-tint', 'danger-tint', 'warn-tint', 'primary-btn', 'primary-btn-hover', 'primary-btn-ink'].map((name) => [name, style.getPropertyValue(`--color-${name}`).trim()]))
        const applied: Record<string, boolean> = {}
        for (const [old, role] of [['brand', 'link'], ['good', 'good-text'], ['danger', 'danger-text'], ['warn', 'warn-text']]) {
          const legacy = document.createElement('span'), expected = document.createElement('span')
          legacy.className = `text-[var(--color-${old})]`
          expected.style.color = `var(--color-${role})`
          document.body.append(legacy, expected)
          applied[role] = getComputedStyle(legacy).color === getComputedStyle(expected).color
          legacy.remove(); expected.remove()
        }
        return { tokens, applied }
      }, { palette, theme })
      expect(Object.values(result.applied)).toEqual([true, true, true, true])
      const pairs = [
        ...['canvas', 'surface', 'subtle', 'brand-tint'].map((bg) => ['link', bg]),
        ...['good', 'danger', 'warn'].flatMap((role) => ['canvas', 'surface', 'subtle', `${role}-tint`].map((bg) => [`${role}-text`, bg])),
        ['primary-btn-ink', 'primary-btn'], ['primary-btn-ink', 'primary-btn-hover'],
      ]
      for (const [fg, bg] of pairs) {
        const a = luminance(result.tokens[fg]), b = luminance(result.tokens[bg])
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${palette}/${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
})

test('a rejected latest preference returns the rendered picker to the confirmed choice', async ({ page }) => {
  await page.goto('/admin/new-table')
  const picker = page.getByTestId('palette-select')
  await expect(picker).toBeVisible()
  await picker.selectOption('ivory')
  await expect.poll(async () => (await page.request.get('/api/whoami')).json().then((who) => who.palette)).toBe('ivory')
  await page.route('**/api/set_palette', (route) => route.fulfill({ status: 500, json: { error: { type: 'TestFailure', message: 'Preference refused' } } }))
  await picker.selectOption('indigo')
  await expect(picker).toHaveValue('ivory')
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ivory')
  await page.getByTestId('dt-file-input').setInputFiles(workbook(['Zones', 'Stores', 'Prices']))
  await expect(page.getByTestId('dt-more-sheets')).toBeVisible()
  await capture(page, 'ivory-preference-rollback')
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await capture(page, 'ivory-dark-warning')
  await page.unroute('**/api/set_palette')
  await page.request.post('/api/set_palette', { data: { palette: 'classic' } })
  await page.request.post('/api/set_theme', { data: { theme: 'light' } })
})

test('generated controls are reachable by labels in a browser, including child rows and error/saved states', async ({ page, request }) => {
  const row = await ensureFormFixtures(request, await adminAuth(request))
  await page.goto(`/admin/${encodeURIComponent(FORM_DT)}/${row}`)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('form fixture')
  await expect(page.getByLabel('Done', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Open')
  await expect(page.getByLabel('Items, Item, row 2')).toHaveValue('nut')
  await page.getByLabel('Title', { exact: true }).fill('Accessible form')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toHaveText('Saved')
  await page.evaluate(() => {
    document.documentElement.dataset.palette = 'indigo'
    document.documentElement.dataset.theme = 'light'
  })
  await capture(page, 'indigo-form-saved')
  await page.route('**/api/save_row', (route) => route.fulfill({ status: 500, json: { error: { type: 'TestFailure', message: 'Save refused for visual verification' } } }))
  await page.getByLabel('Title', { exact: true }).fill('Unsaved correction')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Save refused')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await capture(page, 'indigo-form-error')
})

test('visible attachment actions identify their fields and keyboard activation opens the correct chooser', async ({ page, request }) => {
  const auth = await adminAuth(request)
  await ensureTable(request, auth, {
    name: 'Accessible Attachments',
    columns: [
      { column_name: 'invoice', column_type: 'Attach', label: 'Invoice' },
      { column_name: 'receipt', column_type: 'Attach', label: 'Receipt' },
      { column_name: 'photo', column_type: 'Attach Image', label: 'Photo' },
    ],
  })
  await page.goto('/admin/Accessible%20Attachments/new')
  for (const [field, label, kind, key] of [
    ['invoice', 'Invoice', 'file', 'Enter'],
    ['receipt', 'Receipt', 'file', 'Space'],
    ['photo', 'Photo', 'image', 'Enter'],
  ]) {
    const action = page.getByRole('button', { name: `Attach ${kind} — ${label}`, exact: true })
    await expect(action).toBeVisible()
    await action.focus()
    await expect(action).toBeFocused()
    const chooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press(key)
    const chooser = await chooserPromise
    expect(await chooser.element().getAttribute('data-attach-input')).toBe(field)
    expect(await chooser.element().getAttribute('accept')).toBe(kind === 'image' ? 'image/*' : null)
    await chooser.setFiles([])
  }
  await capture(page, 'accessible-attachment-actions')
})

for (const persisted of [false, true]) {
  test(`${persisted ? 'persisted' : 'unsaved'} child controls retain actual nodes and IDs across edit, reorder and removal`, async ({ page, request }) => {
    const auth = await adminAuth(request)
    await ensureTable(request, auth, {
      name: 'Identity Line', kind: 'sub_table',
      columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }],
    })
    await ensureTable(request, auth, {
      name: 'Identity Form',
      columns: ['items', 'extras'].map((name) => ({ column_name: name, column_type: 'Sub-table', label: name, row_table: 'Identity Line' })),
    })
    let rowId = 'new'
    if (persisted) {
      const response = await request.post('/api/table/Identity%20Form', {
        headers: auth, data: { items: [{ item: 'bolt' }, { item: 'nut' }], extras: [{ item: 'washer' }] },
      })
      expect(response.status()).toBe(201)
      rowId = (await response.json()).row_id
    }
    await page.goto(`/admin/Identity%20Form/${rowId}`)
    if (!persisted) {
      for (const grid of ['items', 'items', 'extras']) await page.getByTestId(`add-row-${grid}`).click()
      await page.getByLabel('items, Item, row 1', { exact: true }).fill('bolt')
      await page.getByLabel('items, Item, row 2', { exact: true }).fill('nut')
      await page.getByLabel('extras, Item, row 1', { exact: true }).fill('washer')
    }
    const nut = page.getByLabel('items, Item, row 2', { exact: true })
    await expect(nut).toHaveValue('nut')
    const node = await nut.elementHandle()
    const originalId = await nut.getAttribute('id')
    const extraId = await page.getByLabel('extras, Item, row 1', { exact: true }).getAttribute('id')
    await nut.fill('nut edited')
    const grid = page.getByRole('group', { name: 'items', exact: true })
    await grid.getByRole('button', { name: 'Move row up' }).nth(1).click()
    await expect(page.getByLabel('items, Item, row 1', { exact: true })).toHaveValue('nut edited')
    expect(await node!.evaluate((el, id) => el.isConnected && el.id === id && document.getElementById(id!) === el, originalId)).toBe(true)
    await grid.getByRole('button', { name: 'Remove row' }).nth(1).click()
    expect(await node!.evaluate((el, id) => el.isConnected && el.id === id && document.getElementById(id!) === el, originalId)).toBe(true)
    expect(await node!.getAttribute('aria-label')).toBe('items, Item, row 1')
    await page.getByTestId('add-row-items').click()
    await page.getByLabel('items, Item, row 2', { exact: true }).fill('replacement')
    expect(await page.getByLabel('extras, Item, row 1', { exact: true }).getAttribute('id')).toBe(extraId)
    const ids = await page.locator('[data-childfield]').evaluateAll((els) => els.map((el) => el.id))
    expect(new Set(ids).size).toBe(ids.length)
    await capture(page, `stable-${persisted ? 'persisted' : 'unsaved'}-child-controls`)
  })
}
