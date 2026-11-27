// #1409: a stand-in dataset, end to end, on the served stack: the Store Sales
// fixture app's own page (plain HTML that knows nothing about stand-ins) under
// the built bar bundle. Its `sales` comes from the warehouse and its `targets`
// is a stand-in loaded from a file, so the bar draws the sample-data line,
// however and whenever the page asked for its rows (fetch, a plain script that
// runs before the bar, XMLHttpRequest); a
// page that shows only sales has none; and after Switch To Warehouse on the
// Datasets page the same page shows the warehouse's targets and no line.
// playwright.served.config.ts lists the fixture app and names its warehouse,
// a sibling database of made-up rows that this spec makes.
import postgres from 'postgres'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { servedWarehouseUrl } from '../playwright.served.config'

const APP_VERSION = { 'X-Featherbase-App-Version': 'storesales@1.0.0' }
const DATASETS = '/featherbase/admin/datasets'
/** The planning workbook's targets, saved as CSV. */
const TARGETS_CSV = ['store,month,target,units,confirmed', 'Northgate,2026-11-01,5000000,12000,false', 'Riverside,2026-11-01,3000000,8000,false', ''].join('\n')
/** A row that only says what `sales` looks like, replaced by the warehouse's at once. */
const SALES_CSV = ['store,business_day,amount,units', 'Northgate,2026-11-26,1,1', ''].join('\n')

async function adminHeaders(request: APIRequestContext) {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' } })
  expect(res.status()).toBe(200)
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}`, ...APP_VERSION }
}

/** The made-up warehouse: the sales it has, and the targets it gets in the end. */
async function makeWarehouse() {
  const url = new URL(servedWarehouseUrl())
  const name = decodeURIComponent(url.pathname.slice(1))
  const server = postgres(Object.assign(new URL(url), { pathname: '/postgres' }).toString(), { max: 1, onnotice: () => {} })
  try {
    const [present] = await server`select 1 from pg_database where datname = ${name}`
    if (!present) await server.unsafe(`create database "${name.replaceAll('"', '""')}"`)
  } finally {
    await server.end({ timeout: 5 })
  }
  const warehouse = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await warehouse.unsafe(`drop schema if exists standin_proof cascade; create schema standin_proof;
      create table standin_proof.sales (store text, business_day date, amount numeric, units integer);
      create table standin_proof.targets (store text, month date, target numeric, units integer, confirmed boolean);
      insert into standin_proof.sales values ('Northgate', '2026-11-26', 191250.5, 428), ('Riverside', '2026-11-26', 97800, 246);
      insert into standin_proof.targets values ('Northgate', '2026-11-01', 5200000, 11800, true), ('Riverside', '2026-11-01', 2650000, 6500, true);`)
  } finally {
    await warehouse.end({ timeout: 5 })
  }
}

test.beforeAll(async ({ request }) => {
  await makeWarehouse()
  const headers = await adminHeaders(request)
  const post = (path: string, data: unknown) => request.post(path, { headers, data })
  expect([201, 409]).toContain((await post('/api/install_app', { name: 'storesales' })).status())
  expect([201, 409]).toContain((await post('/api/table/Data%20Source', {
    row_id: 'storesales-warehouse', engine: 'postgres', url_env: 'STAND_IN_PROOF_WAREHOUSE_URL', access: 'read_only',
  })).status())
  // `sales` gets its real rows now. This stack's job queue never ticks, so the
  // refresh is run the way a System Manager runs one: a switch to the warehouse.
  expect((await post('/api/datasets/storesales/sales/load_stand_in', { csv: SALES_CSV })).status()).toBe(201)
  expect(await (await post('/api/datasets/storesales/sales/switch_to_warehouse', {})).json()).toMatchObject({ switched: true, rows: 2 })
  // `targets` is not in the warehouse's shape yet, as far as the app is told: a stand-in.
  expect((await post('/api/datasets/storesales/targets/load_stand_in', {
    csv: TARGETS_CSV, note: 'From the planning workbook', expected_by: '2026-12-15',
  })).status()).toBe(201)
})

/** The Store Sales page, once its own script has drawn what it read. */
async function openStoreSales(page: Page, address = '/storesales/') {
  await page.goto(address)
  await expect(page.locator('body[data-loaded="true"]')).toBeAttached()
  await expect(page.getByRole('button', { name: 'Switch application: Store Sales' })).toBeVisible()
}
const rowsOf = (page: Page, section: 'sales' | 'targets') => page.locator(`#${section} tbody tr`)
/** The requests the page's mark remembers stand-ins for, by the names it keeps them under (lib/stand-in-mark.ts). */
const rememberedAs = (page: Page) => page.evaluate(() => {
  const remembered = (window as unknown as Record<symbol, { pages: Map<string, Map<string, unknown>> }>)[Symbol.for('featherbase.stand-ins')]
  return [...(remembered.pages.get(window.location.pathname)?.keys() ?? [])]
})
/** The whole line while `targets` is the page's one stand-in. */
const MARKED = /^Sample data: targets is a stand-in, loaded \d{2}-[A-Z][a-z]{2}-\d{4}\. Real data expected by 15-Dec-2026\. From the planning workbook$/

test('a page that shows a stand-in says so under the bar, until the dataset is switched to the warehouse', async ({ page }) => {
  await page.goto('/featherbase/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', process.env.ADMIN_PASSWORD ?? 'admin')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('session-user')).toBeVisible()

  const line = page.getByTestId('stand-in-line')
  await test.step('the Store Sales page shows both tables, and one line under the bar names targets only', async () => {
    await openStoreSales(page)
    await expect(rowsOf(page, 'sales')).toHaveCount(2)
    await expect(rowsOf(page, 'targets')).toHaveCount(2)
    await expect(page.locator('#targets')).toContainText('50,00,000')
    await expect(line).toHaveCount(1)
    await expect(line).toHaveText(MARKED)
    await expect(line).not.toContainText('sales')
    // The line is the platform's, in the bar's own shadow root: across the
    // page, directly under the bar and above the app's content.
    expect(await line.evaluate((el) => (el.getRootNode() as ShadowRoot).host?.tagName)).toBe('FEATHERBASE-BAR')
    const [bar, drawn, content] = await Promise.all([page.getByTestId('top-bar').boundingBox(), line.boundingBox(), page.locator('#store-sales-page').boundingBox()])
    expect(drawn!.width).toBe(1280)
    expect(Math.abs(drawn!.y - (bar!.y + bar!.height))).toBeLessThanOrEqual(1)
    expect(content!.y).toBeGreaterThanOrEqual(drawn!.y + drawn!.height)
    await expect(page.locator('#store-sales-page')).not.toContainText('Sample data')
  })

  await test.step('a page of the app that shows only sales has no line', async () => {
    await openStoreSales(page, '/storesales/?only=sales')
    await expect(rowsOf(page, 'sales')).toHaveCount(2)
    await expect(page.locator('#targets')).toBeHidden()
    await expect(line).toHaveCount(0)
  })

  // The line must not depend on how or when the page asked. The fixture page
  // can ask from a plain script, which runs before the bar's module exists
  // (`?how=early`), or through XMLHttpRequest (`?how=xhr`).
  await test.step('a page that asked before the bar loaded is marked the same', async () => {
    await openStoreSales(page, '/storesales/?how=early')
    await expect(rowsOf(page, 'targets')).toHaveCount(2)
    await expect(line).toHaveText(MARKED)
    // It did ask first: neither wrapper saw the read, so it is remembered as the browser kept it.
    expect(await rememberedAs(page)).toEqual([expect.stringMatching(/^early \/api\/app_reads\/storesales\/overview [\d.]+$/)])
    await openStoreSales(page, '/storesales/?only=sales&how=early')
    await expect(rowsOf(page, 'sales')).toHaveCount(2)
    await expect(line).toHaveCount(0)
  })

  await test.step('a page that asks through XMLHttpRequest is marked the same', async () => {
    await openStoreSales(page, '/storesales/?how=xhr')
    await expect(rowsOf(page, 'targets')).toHaveCount(2)
    await expect(line).toHaveText(MARKED)
    // It did go through XMLHttpRequest, and was read as a request with its body.
    expect(await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find((each) => each.name.endsWith('/api/app_reads/storesales/overview'))!.initiatorType)).toBe('xmlhttprequest')
    expect(await rememberedAs(page)).toEqual(['POST /api/app_reads/storesales/overview {"payload":{}}'])
    await openStoreSales(page, '/storesales/?only=sales&how=xhr')
    await expect(rowsOf(page, 'sales')).toHaveCount(2)
    await expect(line).toHaveCount(0)
  })

  await test.step('for a System Manager the dataset in the line opens the Datasets page', async () => {
    await openStoreSales(page)
    await line.getByRole('link', { name: 'targets' }).click()
    await expect(page).toHaveURL(new RegExp(`${DATASETS}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Datasets' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Store Sales' })).toBeVisible()
    // The Datasets page itself received no stand-in rows.
    await expect(line).toHaveCount(0)
  })

  await test.step('Switch To Warehouse on the Datasets page moves targets to the warehouse', async () => {
    const targets = page.getByTestId('dataset-storesales.targets')
    await expect(targets.getByTestId('served-from')).toHaveText('Stand-in')
    await expect(page.getByTestId('dataset-storesales.sales').getByTestId('served-from')).toHaveText('Warehouse')
    await test.step('rows of several lines stay apart, the Data Source stays on one line, and As Of opens the snapshot', async () => {
      // What each cell holds keeps 8px above and below it, in the built stylesheet.
      const padding = await targets.locator('th > *, td > *').evaluateAll((held) => held.map((each) => [getComputedStyle(each).paddingTop, getComputedStyle(each).paddingBottom]))
      expect(padding).toEqual(Array.from({ length: 5 }, () => ['8px', '8px']))
      const [header, firstName] = await Promise.all([page.locator('thead').boundingBox(), page.getByTestId('dataset-storesales.sales').getByRole('link', { name: 'sales', exact: true }).boundingBox()])
      expect(firstName!.y - (header!.y + header!.height)).toBeGreaterThanOrEqual(8)
      // One line of 12px text is 16px high; wrapped, it would be 32.
      expect((await targets.getByTestId('dataset-source').boundingBox())!.height).toBeLessThan(24)
      await expect(targets.getByRole('link', { name: /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/ })).toHaveAttribute('href', /\/table\/dataset-snapshot\/row\//)
    })
    await targets.getByRole('button', { name: 'Switch targets To Warehouse' }).click()
    await expect(page.getByText('targets now reads the warehouse: 2 rows.')).toBeVisible()
    await expect(targets.getByTestId('served-from')).toHaveText('Warehouse')
    await expect(targets.getByRole('button')).toHaveCount(0)
  })

  await test.step("the same Store Sales page now shows the warehouse's targets, and no line", async () => {
    await openStoreSales(page)
    await expect(rowsOf(page, 'targets')).toHaveCount(2)
    await expect(page.locator('#targets')).toContainText('52,00,000')
    await expect(page.locator('#targets')).not.toContainText('50,00,000')
    await expect(rowsOf(page, 'sales')).toHaveCount(2)
    await expect(line).toHaveCount(0)
  })
})
