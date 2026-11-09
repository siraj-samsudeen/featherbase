// external-data-sources' fenced scenarios a person reads on screen (#1070),
// rendered in jsdom against the real in-process server: an outside Postgres
// database in the run's sibling database, and a MotherDuck stand-in. Each test
// is one scenario of openspec/specs/external-data-sources/spec.md, step by
// step; the ones the server alone proves are in apps/server/test/scenarios/.
//
// A link that loads a new document (a breadcrumb) is followed by rendering the
// app at its address, as the browser would load it; jsdom cannot navigate.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { rowHref, tableHref } from 'shared'
import { sql } from 'server/src/db'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { addStandinTable, buildStandin, changeStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { EXPLORE_FLOOR, EXPLORE_STORE, dropExploreSource, exploreSource } from 'server/test/explore-source'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, inside, byTestId } from '../pg-test'

const scenario = scenarioFor(test, 'external-data-sources')
const WAIT = { timeout: 15_000 }
type Rendered = Awaited<ReturnType<typeof renderApp>>
let app: Rendered | undefined
async function visit(path: string, who: TestClient) {
  app?.unmount()
  app = await renderApp(path, who)
  return app
}
const enc = encodeURIComponent
const byLabel = (label: string) => screen.getByLabelText(label, { exact: true, selector: 'input, textarea, select' }) as HTMLInputElement

// ---- The outside Postgres database, read through one login that owns nothing.
const READER = `scn_reader_${randomBytes(6).toString('hex')}`
const READER_PASSWORD = randomBytes(24).toString('hex')
const READER_ENV = 'SCENARIO_EDS_READER_URL'
const SCHEMAS = { shop: 'scn_eds_shop', shelf: 'scn_eds_shelf', parcel: 'scn_eds_parcel' }
let owner: ReturnType<typeof postgres>
const outside = (statement: string, params: unknown[] = []) => owner.unsafe(statement, params as never[])

// ---- The MotherDuck stand-in.
let standin: string

beforeAll(async () => {
  owner = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await outside(`create role ${READER} login password '${READER_PASSWORD}'`)
  const url = new URL(EXTERNAL_DATABASE_URL)
  url.username = READER
  url.password = READER_PASSWORD
  process.env[READER_ENV] = url.toString()
  standin = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', standin)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
// A scenario that changes the instance's token leaves the next one the reader's.
afterEach(() => { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
afterAll(async () => {
  invalidateSources()
  for (const schema of Object.values(SCHEMAS)) await outside(`drop schema if exists ${schema} cascade`)
  await dropExploreSource(EXPLORE)
  await outside(`drop owned by ${READER}`).catch(() => {})
  await outside(`drop role if exists ${READER}`)
  await owner.end({ timeout: 2 })
  delete process.env[READER_ENV]
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(standin, { recursive: true, force: true })
})

/** A data source through the reader login, which may read these tables of the schema and owns nothing. */
async function readerSource(admin: TestClient, source: string, schema: string, tables: string[]) {
  await outside(`grant usage on schema ${schema} to ${READER}`)
  for (const table of tables) await outside(`grant select on ${schema}.${table} to ${READER}`)
  const [owned] = await outside(`select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`, [READER])
  expect(owned!.n, 'the reader login must own nothing').toBe(0)
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: source, engine: 'postgres', url_env: READER_ENV, default_schema: schema, access: 'read_only' })
}

/** A person with read access to these Tables, and nothing else. */
async function reader(admin: TestClient, createUser: (o: { roles: string[] }) => Promise<TestClient>, tables: string[]) {
  const roles: string[] = []
  for (const table of tables) {
    const role = `${table} Reader`
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: role } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role, operation: 'read' } })
    roles.push(role)
  }
  return createUser({ roles })
}

// ---- Shops (#782) and shelves and bins (#783, #796).
const SHOP_SOURCE = 'shops'
const SHOPS = ['North', 'South']
const SHELF_SOURCE = 'shelves'
const SHELVES = SCHEMAS.shelf
const BIN = 'b1'

async function shopDatabase() {
  const s = SCHEMAS.shop
  await outside(`drop schema if exists ${s} cascade`)
  await outside(`create schema ${s}`)
  await outside(`create table ${s}.shop (id bigint primary key, name text)`)
  await outside(`insert into ${s}.shop values (1, $1), (2, $2)`, SHOPS)
}
async function shelfDatabase() {
  await outside(`drop schema if exists ${SHELVES} cascade`)
  await outside(`create schema ${SHELVES}`)
  // The aisle comes before the label, so a shelf read by its first value would
  // read as its aisle (#796); created_on is bookkeeping a list leaves out.
  await outside(`create table ${SHELVES}.shelf (id bigint primary key, created_on timestamptz not null default now(), aisle text, label text)`)
  await outside(`create table ${SHELVES}.bin (code text primary key, shelf_id bigint references ${SHELVES}.shelf(id))`)
  await outside(`insert into ${SHELVES}.shelf (id, aisle, label) values (7, 'West', 'Middle')`)
  await outside(`insert into ${SHELVES}.bin values ('${BIN}', 7)`)
}
async function connectShelves(admin: TestClient, names: Record<string, string>) {
  await readerSource(admin, SHELF_SOURCE, SHELVES, ['shelf', 'bin'])
  await admin.post(`/api/table/Data%20Source/${SHELF_SOURCE}:reflect`, { schema: SHELVES, tables: Object.keys(names), names })
}

/** A data source's Browse screen, loaded on a schema. */
async function browse(admin: TestClient, source: string, schema: string) {
  await visit(`/featherbase/admin/source/${enc(source)}`, admin)
  const box = await screen.findByTestId('sb-schema', {}, WAIT)
  await userEvent.clear(box)
  await userEvent.type(box, schema)
  await userEvent.click(screen.getByTestId('sb-load'))
}
const choice = (schema: string, table: string) => screen.getByRole('checkbox', { name: `Reflect ${schema}.${table}` }) as HTMLInputElement
async function connectChosen() {
  await userEvent.click(screen.getByTestId('sb-reflect'))
  const created = await within(await screen.findByTestId('sb-result', {}, WAIT)).findAllByRole('link', {}, WAIT)
  return created[0]!.textContent!.trim()
}

const listColumns = () =>
  [...screen.getByTestId('list-view').querySelectorAll('thead [data-testid^="col-"]')]
    .filter((c) => c.getAttribute('data-testid') !== 'col-row_id').map((c) => c.textContent!.replace(/[↑↓]/g, '').trim())
async function openList(table: string, as: TestClient) {
  await visit(tableHref(table), as)
  await screen.findByTestId('list-view', {}, WAIT)
}
async function openRow(table: string, id: string, as: TestClient) {
  await visit(rowHref(table, id), as)
  return screen.findByTestId('form-view', {}, WAIT)
}
const offerToConnect = (label: string) => within(screen.getByTestId('form-view')).queryByRole('link', { name: `Connect the ${label.toLowerCase()} table` })
function noteBeside(label: string) {
  const field = within(screen.getByTestId('form-view')).getByLabelText(label, { exact: true })
  return (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ')
}
async function openMap(table: string, id: string, as: TestClient) {
  await visit(rowHref(table, id), as)
  await onScreen().clickButton('Map')
  // A tab by its name: the DSL's attribute verbs read an element found by selector.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true'), WAIT)
  await screen.findByTestId('map-center', {}, WAIT)
  return screen.findByTestId('map-forward-Shelf', {}, WAIT)
}

// ---- Exploring a connected source (#786).
const EXPLORE = 'scenario_explore_web'
async function explore(admin: TestClient, selected?: string) {
  await visit('/featherbase/admin/explore', admin)
  const user = userEvent.setup()
  const root = (await screen.findByTestId('explore-root', {}, WAIT)) as HTMLSelectElement
  const store = await waitFor(() => {
    const option = [...root.options].find((o) => o.value === EXPLORE_STORE || o.textContent === EXPLORE_STORE)
    expect(option, `no ${EXPLORE_STORE} to explore`).toBeDefined()
    return option!
  }, WAIT)
  await user.selectOptions(root, store)
  await waitFor(() => expect(screen.getByTestId('explore-step2').querySelector(`option[value="backlink:${EXPLORE_FLOOR}:store"]`)).not.toBeNull(), WAIT)
  await user.selectOptions(screen.getByTestId('explore-step2'), `backlink:${EXPLORE_FLOOR}:store`)
  // The store's row is a button named by its title; its "show in the pane" control is hidden until hovered.
  if (selected) await user.click(await waitFor(() => {
    const row = within(screen.getByTestId('explore-pane1')).getAllByTestId('explore-row').find((r) => r.querySelector('span')?.textContent === selected)
    expect(row, `no store ${selected} to select`).toBeDefined()
    return row!
  }, WAIT))
}
async function expectFloors(labels: string[], count: number) {
  const pane = await screen.findByTestId('explore-pane2', {}, WAIT)
  // A failure must not look like an empty result.
  await waitFor(() => expect(within(pane).getByTestId('explore-pane2-count').textContent).toBe(String(count)), WAIT)
  const names = within(pane).queryAllByTestId('explore-row').map((row) => row.querySelector('span')!.textContent)
  expect(names.sort()).toEqual(labels.slice().sort())
  expect(within(pane).queryByText(/Cannot load/)).toBeNull()
}

// ---- Parcels on racks (#795).
const PARCEL_SOURCE = 'parcels'

// ---- The MotherDuck warehouse (#772, #969).
async function givenSource(admin: TestClient, databases: string[], token = STANDIN_TOKENS.reader) {
  overrideVariable('MOTHERDUCK_TOKEN', token)
  invalidateSources()
  const source = `acc-wh-${randomUUID().slice(0, 8)}`
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name: source, databases })
  return source
}
async function openConnect(admin: TestClient) {
  await visit('/featherbase/admin/table/data-source/new', admin)
  await userEvent.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  // The result replaces the waiting line once MotherDuck has answered.
  await waitFor(() => expect(screen.getByTestId('connect-result').textContent).toMatch(/Connected|refused|cannot|could not|not set/), WAIT)
}
const connectResult = () => screen.getByTestId('connect-result').textContent ?? ''
const sourceBlock = (source: string) => within(screen.getByTestId('sidebar-group-sources')).getAllByTestId('sidebar-source')
  .find((block) => within(block).queryAllByTestId('sidebar-source-link').some((link) => link.textContent === source))
async function openAdmin(as: TestClient) {
  await visit('/featherbase/admin', as)
  await screen.findByTestId('sidebar-group-data', {}, WAIT)
}
async function databasesUnder(source: string) {
  await screen.findByTestId('sidebar-group-sources', {}, WAIT)
  const block = await waitFor(() => { const b = sourceBlock(source); expect(b).toBeDefined(); return b! }, WAIT)
  return within(block).getAllByTestId('sidebar-source-database').map((d) => d.textContent)
}
const browserDatabase = () => screen.getByTestId('browser-database') as HTMLSelectElement
const schemaBox = () => screen.getByRole('combobox', { name: 'Schema' }) as HTMLSelectElement
async function openBrowser(source: string, as: TestClient) {
  await visit(`/featherbase/admin/source/${enc(source)}`, as)
}
async function showCatalog() {
  await userEvent.click(await screen.findByRole('tab', { name: /tables|catalog/i }, WAIT))
}
async function pickDatabase(database: string) {
  await userEvent.selectOptions(await screen.findByTestId('browser-database', {}, WAIT), database)
}
async function pickSchema(schema: string) {
  await showCatalog()
  // Waits for the schema to be offered: selectOption looks for its option once.
  await waitFor(() => expect([...schemaBox().options].map((o) => o.value)).toContain(schema), WAIT)
  await onScreen().selectOption('Schema', schema)
}
async function pickTable(table: string) {
  await showCatalog()
  const catalog = await screen.findByRole('table', { name: 'Warehouse tables' }, WAIT)
  await userEvent.click(await within(catalog).findByRole('button', { name: table }, WAIT))
  await inside(onScreen(), 'preview-size', (el) => el.assertText('rows'))
}
async function place() {
  await showCatalog()
  return { database: browserDatabase().value, schema: schemaBox().value }
}
async function catalogTables() {
  const catalog = await screen.findByRole('table', { name: 'Warehouse tables' }, WAIT)
  return [...catalog.querySelectorAll('tbody tr th')].map((th) => (th as HTMLElement).textContent!.trim())
}
const previewTab = (table: string) => screen.getByRole('tab', { name: `Preview · ${table}` })
const previewTitle = () => within(screen.getByTestId('pane-preview')).getAllByRole('heading', { level: 2 })[0]!.textContent!.trim()
async function catalogContext() {
  return { ...(await place()), query: (screen.getByRole('searchbox', { name: 'Tables' }) as HTMLInputElement).value, tables: await catalogTables() }
}
async function previewing(admin: TestClient, source: string, table: string, schema: string, database: string, query?: string) {
  await openBrowser(source, admin)
  await pickDatabase(database)
  await pickSchema(schema)
  if (query !== undefined) {
    const search = screen.getByRole('searchbox', { name: 'Tables' })
    await userEvent.clear(search)
    await userEvent.type(search, query)
  }
  await pickTable(table)
}
async function openCopy() {
  await userEvent.click(screen.getByTestId('preview-copy'))
  return screen.findByTestId('copy-setup', {}, WAIT)
}
async function editColumn(source: string, values: { name: string; label: string; description: string }) {
  for (const [field, value] of [['Name', values.name], ['Label', values.label], ['Description', values.description]] as const) {
    const box = screen.getByRole('textbox', { name: `${field} for ${source}` })
    await userEvent.clear(box)
    await userEvent.type(box, value)
  }
}
async function omit(source: string) {
  const keep = screen.getByRole('checkbox', { name: `Keep ${source}` })
  if ((keep as HTMLInputElement).checked) await userEvent.click(keep)
}
async function searchMapping(query: string) {
  const search = screen.getByRole('searchbox', { name: 'Column mapping' })
  await userEvent.clear(search)
  if (query) await userEvent.type(search, query)
}
const mappingColumn = (source: string) => ({
  name: (screen.getByRole('textbox', { name: `Name for ${source}` }) as HTMLInputElement).value,
  label: (screen.getByRole('textbox', { name: `Label for ${source}` }) as HTMLInputElement).value,
  description: (screen.getByRole('textbox', { name: `Description for ${source}` }) as HTMLInputElement).value,
  keep: (screen.getByRole('checkbox', { name: `Keep ${source}` }) as HTMLInputElement).checked,
})

/** A warehouse table of its own holding the three stores, and a source reading "sales". */
async function storeWarehouse(admin: TestClient) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const w = { table: `copy_${suffix}`, native: `Warehouse Copy ${suffix}`, source: '' }
  await changeStandin(standin, 'sales', [`create table ${w.table} as select * from stores`])
  w.source = await givenSource(admin, ['sales'])
  return w
}
type Warehouse = Awaited<ReturnType<typeof storeWarehouse>>
async function correctedCopy(admin: TestClient, store: string) {
  const w = await storeWarehouse(admin)
  await admin.post(`/api/table/Data%20Source/${enc(w.source)}:copy_create`, {
    database: 'sales', schema: 'main', table: w.table, name: w.native, key: 'code',
    columns: [
      { source: 'code', column_name: 'store_code', label: 'Store code' },
      { source: 'name', column_name: 'store_name', label: 'Trading name' },
      { source: 'state_code', column_name: 'state_code', label: 'State code' },
    ],
  })
  // The copy was made before today's work: one sandbox transaction gives every
  // row the same clock, which would tie the copy with a later Copy again in the
  // import history.
  await sql`update import_log set created_at = created_at - interval '1 hour' where ref_table = ${w.native}`
  const row = await admin.get<Record<string, unknown>>(`/api/table/${enc(w.native)}/${store}`)
  await admin.post('/api/save_row', { table: w.native, row: { ...row, state_code: '32' } })
  return w
}
async function warehouseChanges(admin: TestClient, w: Warehouse) {
  await changeStandin(standin, 'sales', [
    `update ${w.table} set name = 'Harbour Road renewed' where code = 'S001'`,
    `insert into ${w.table} values ('S004', 'New Quay', 'Omitted City', '07')`,
  ])
  await admin.post(`/api/table/Data%20Source/${enc(w.source)}:refresh_tables`, { database: 'sales' })
}
/** Every :copy_again the page sends, with the server's answer. */
function recordCopyAgain() {
  const answers: { status: number; body: { error?: { message?: string } } }[] = []
  const bridged = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await bridged(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.split('?')[0]!.endsWith(':copy_again') && init?.method === 'POST') answers.push({ status: res.status, body: await res.clone().json() })
    return res
  }) as typeof fetch
  return { answers, restore: () => { globalThis.fetch = bridged } }
}
async function copyAgain(admin: TestClient, native: string) {
  await openList(native, admin)
  const record = recordCopyAgain()
  try {
    await onScreen().clickButton('Copy again')
    await waitFor(() => expect(record.answers).toHaveLength(1), WAIT)
  } finally { record.restore() }
  return record.answers[0]!
}
async function formValue(native: string, store: string, label: string, admin: TestClient) {
  await openRow(native, store, admin)
  return waitFor(() => { const v = byLabel(label).value; expect(v).not.toBe(''); return v }, WAIT)
}
async function nativeRowIds() {
  const rows = await screen.findByTestId('list-rows', {}, WAIT)
  return waitFor(() => { const ids = within(rows).getAllByRole('link').map((a) => a.textContent!.trim()); expect(ids.length).toBeGreaterThan(0); return ids }, WAIT)
}
async function originalStores(admin: TestClient, native: string) {
  await openList(native, admin)
  await waitFor(async () => expect((await nativeRowIds()).sort()).toEqual(['S001', 'S002', 'S003']), WAIT)
  expect(await formValue(native, 'S001', 'Trading name', admin)).toBe('Harbour Road')
}

describe('external-data-sources', () => {
  scenario("A warehouse table's size and first rows show", async ({ admin }, step) => {
    let source = ''
    await step('a MotherDuck source reading the databases "sales" and "stock"', async () => { source = await givenSource(admin, ['sales', 'stock']) })
    await step('the user opens "sales", picks the schema "main" and the table "stores"', async () => {
      await openAdmin(admin)
      await databasesUnder(source)
      const block = sourceBlock(source)!
      await userEvent.click(within(block).getAllByTestId('sidebar-source-database').find((d) => d.textContent === 'sales')!)
      await screen.findByTestId('warehouse-browser', {}, WAIT)
      await pickSchema('main')
      await pickTable('stores')
    })
    await step('they see how many rows and columns "stores" has, its first rows and its column names', () => {
      expect(previewTitle()).toBe('stores')
      expect(screen.getByTestId('preview-size').textContent).toMatch(/3 rows · 4 columns/)
      expect(screen.getByTestId('preview-rows').textContent).toMatch(/Harbour Road/)
      for (const column of ['code', 'name', 'city', 'state_code']) expect(screen.getByTestId('preview-columns').textContent).toContain(column)
    })
  })

  scenario('Someone who is not a System Manager sees no source', async ({ admin, createUser }, step) => {
    let source = ''
    let clerk: TestClient
    await step('a MotherDuck source reading the databases "sales" and "stock"', async () => { source = await givenSource(admin, ['sales', 'stock']) })
    await step('a user who is not a System Manager looks for it', async () => {
      clerk = await reader(admin, createUser, ['Import Log'])
      await openAdmin(clerk)
    })
    await step("the sidebar lists no data source, and opening the source's browser is refused", async () => {
      expect(screen.queryByTestId('sidebar-group-sources')).toBeNull()
      await openBrowser(source, clerk)
      await screen.findByTestId('table-page', {}, WAIT)
      expect(await screen.findByTestId('source-refused', {}, WAIT)).toBeVisible()
    })
  })

  scenario('Shops connect through a login that owns nothing', async ({ admin }, step) => {
    let table = ''
    await step('the user is a System Manager')
    await step('a Postgres database with a shop table whose rows are identified by their id', shopDatabase)
    await step('a data source whose login may only read that table and owns nothing', () => readerSource(admin, SHOP_SOURCE, SCHEMAS.shop, ['shop']))
    await step('the user browses the data source', async () => {
      await browse(admin, SHOP_SOURCE, SCHEMAS.shop)
      await screen.findByTestId('sb-row-shop', {}, WAIT)
    })
    await step('the shop table is offered for connecting', () => {
      const offered = choice(SCHEMAS.shop, 'shop')
      expect(offered.disabled, `the shop table is not offered: "${screen.getByTestId('sb-row-shop').querySelector('td:last-child')?.textContent}"`).toBe(false)
    })
    await step('the user connects it', async () => {
      await userEvent.click(choice(SCHEMAS.shop, 'shop'))
      table = await connectChosen()
    })
    await step("the user sees the database's shops listed in Featherbase", async () => {
      await openList(table, admin)
      for (const shop of SHOPS) await inside(onScreen(), 'list-rows', (rows) => rows.assertText(shop))
    })
  })

  scenario('The tables read "Shelf" and "Bin"', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('a data source for that database', () => readerSource(admin, SHELF_SOURCE, SHELVES, ['shelf', 'bin']))
    await step('the user connects its shelf and bin tables, naming them "Shelf" and "Bin"', async () => {
      await browse(admin, SHELF_SOURCE, SHELVES)
      await screen.findByTestId('sb-row-bin', {}, WAIT)
      for (const [table, name] of [['shelf', 'Shelf'], ['bin', 'Bin']]) {
        await userEvent.click(choice(SHELVES, table!))
        const box = within(screen.getByTestId(`sb-row-${table}`)).getByRole('textbox', { name: `Name for ${SHELVES}.${table}` })
        await userEvent.clear(box)
        await userEvent.type(box, name!)
      }
      await connectChosen()
    })
    await step('the user sees tables called "Shelf" and "Bin" in Featherbase', async () => {
      for (const name of ['Shelf', 'Bin']) await openList(name, admin)
    })
  })

  scenario('A bin\'s shelf is labelled "Shelf"', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('its shelf and bin tables connected as "Shelf" and "Bin"', () => connectShelves(admin, { shelf: 'Shelf', bin: 'Bin' }))
    await step('the user opens a bin', () => openRow('Bin', BIN, admin))
    await step('the user sees its link to a shelf labelled "Shelf"', async () => {
      expect(await screen.findByLabelText('Shelf', { exact: true }, WAIT)).toBeInTheDocument()
    })
  })

  scenario('A bin\'s shelf reads "Top" on the relationship map', async ({ admin }, step) => {
    let box: HTMLElement
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('its shelf and bin tables connected as "Shelf" and "Bin"', () => connectShelves(admin, { shelf: 'Shelf', bin: 'Bin' }))
    await step('a bin on the shelf titled "Top"', () => outside(`update ${SHELVES}.shelf set label = 'Top' where id = 7`))
    await step("the user opens that bin's relationship map", async () => { box = await openMap('Bin', BIN, admin) })
    await step('the user sees its shelf as "Top"', async () => {
      await waitFor(() => expect(within(box).getByText('Top', { exact: true }), `the shelf box reads "${box.textContent}"`).toBeInTheDocument(), WAIT)
    })
  })

  scenario('A shelf the user may not read keeps its title hidden', async ({ admin, createUser }, step) => {
    let user: TestClient
    let box: HTMLElement
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('its shelf and bin tables connected as "Shelf" and "Bin"', () => connectShelves(admin, { shelf: 'Shelf', bin: 'Bin' }))
    await step('a bin on the shelf titled "Top"', () => outside(`update ${SHELVES}.shelf set label = 'Top' where id = 7`))
    await step('the user may read bins but not shelves', async () => { user = await reader(admin, createUser, ['Bin']) })
    await step("the user opens that bin's relationship map", async () => { box = await openMap('Bin', BIN, user) })
    await step('the user does not see "Top"', async () => {
      await waitFor(() => expect(box.textContent!.trim()).not.toBe(''), WAIT)
      expect(screen.getByRole('main').textContent, '"Top" is shown').not.toContain('Top')
    })
  })

  scenario('All connected floors appear before selecting a store', async ({ admin }, step) => {
    await step('a connected Postgres source has North with two floors, South with one floor and Empty with none', () => exploreSource(admin, EXPLORE))
    await step('the user explores stores followed by floors without selecting a store', () => explore(admin))
    await step('the user sees the three linked floors with a total of three', () => expectFloors(['North one', 'North two', 'South only'], 3))
  })

  scenario('Selecting a store narrows its floors', async ({ admin }, step) => {
    await step('a connected Postgres source has North with two floors, South with one floor and Empty with none', () => exploreSource(admin, EXPLORE))
    await step('the user explores floors for North', () => explore(admin, 'North'))
    await step("the user sees only North's two floors with a total of two", () => expectFloors(['North one', 'North two'], 2))
  })

  scenario('Selecting an empty store shows no floors', async ({ admin }, step) => {
    await step('a connected Postgres source has North with two floors, South with one floor and Empty with none', () => exploreSource(admin, EXPLORE))
    await step('the user explores floors for Empty', () => explore(admin, 'Empty'))
    await step('the user sees no floors with a total of zero', () => expectFloors([], 0))
  })

  scenario('A shelf is titled by its label, not its aisle', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('a shelf labelled "Top" in the "East" aisle', () => outside(`update ${SHELVES}.shelf set label = 'Top', aisle = 'East' where id = 7`))
    await step('its shelf and bin tables connected as "Shelf" and "Bin"', () => connectShelves(admin, { shelf: 'Shelf', bin: 'Bin' }))
    await step('the user opens that shelf', () => openRow('Shelf', '7', admin))
    await step('the user sees the shelf as "Top"', async () => {
      const heading = () => within(screen.getByTestId('form-view')).getAllByRole('heading', { level: 1 })[0]!
      await waitFor(() => expect(heading().textContent, `the shelf reads "${heading().textContent}"`).toMatch(/:\s*Top$/), WAIT)
    })
  })

  scenario('The shelf list leaves out when each shelf was created', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('a shelf labelled "Top" in the "East" aisle', () => outside(`update ${SHELVES}.shelf set label = 'Top', aisle = 'East' where id = 7`))
    await step('its shelf and bin tables connected as "Shelf" and "Bin"', () => connectShelves(admin, { shelf: 'Shelf', bin: 'Bin' }))
    await step('the user opens the list of shelves', () => openList('Shelf', admin))
    await step("the user sees each shelf's label and aisle", async () => {
      await waitFor(() => { for (const label of ['Label', 'Aisle']) expect(listColumns(), `the list shows ${listColumns().join(', ')}`).toContain(label) }, WAIT)
    })
    await step('the user does not see when each shelf was created', () => {
      expect(listColumns().some((l) => /created/i.test(l)), `the list shows ${listColumns().join(', ')}`).toBe(false)
    })
  })

  scenario("A bin's shelf says its table isn't connected", async ({ admin, createUser }, step) => {
    let user: TestClient
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('only its bin table connected, as "Bin"', () => connectShelves(admin, { bin: 'Bin' }))
    await step('the user may read bins', async () => { user = await reader(admin, createUser, ['Bin']) })
    await step('the user opens a bin', () => openRow('Bin', BIN, user))
    await step("the user sees that its shelf's table is not connected yet", async () => {
      await waitFor(() => expect(noteBeside('Shelf')).toMatch(/not connected yet/i), WAIT)
    })
    await step('the user is not offered to connect it', () => expect(offerToConnect('Shelf'), 'the user is offered to connect it').toBeNull())
  })

  scenario('A System Manager is offered the shelf table', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('only its bin table connected, as "Bin"', () => connectShelves(admin, { bin: 'Bin' }))
    await step('the user opens a bin', () => openRow('Bin', BIN, admin))
    await step("the user sees that its shelf's table is not connected yet", async () => {
      await waitFor(() => expect(noteBeside('Shelf')).toMatch(/not connected yet/i), WAIT)
    })
    await step('the user is offered to connect the shelf table', () => waitFor(() => expect(offerToConnect('Shelf')).not.toBeNull(), WAIT))
  })

  scenario('The shelf table is ready to connect', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('a Postgres database of shelves and the bins on each shelf', shelfDatabase)
    await step('only its bin table connected, as "Bin"', () => connectShelves(admin, { bin: 'Bin' }))
    await step('the user opens a bin and takes the offer to connect the shelf table', async () => {
      await openRow('Bin', BIN, admin)
      await userEvent.click(await waitFor(() => { const offer = offerToConnect('Shelf'); expect(offer).not.toBeNull(); return offer! }, WAIT))
    })
    await step('the user sees the shelf table chosen, ready to connect', async () => {
      await waitFor(() => expect(choice(SHELVES, 'shelf').checked, 'the shelf table is not chosen').toBe(true), WAIT)
    })
  })

  scenario("The parcel's sender reads on one line", async ({ admin, createUser }, step) => {
    const s = SCHEMAS.parcel
    let user: TestClient
    let value: (label: string) => HTMLElement
    await step('a connected database of parcels on racks, where every parcel has a sender of up to 500 characters', async () => {
      await outside(`drop schema if exists ${s} cascade`)
      await outside(`create schema ${s}`)
      await outside(`create table ${s}.rack (id bigint primary key, label text)`)
      // Source order: who created it first, the label in the middle, the rack and who updated it last.
      await outside(`create table ${s}.parcel (id bigint primary key, created_on timestamptz not null default now(),
        label varchar(300), weight numeric(6,2), note text, fragile boolean, instructions text, sent_on date, photo text,
        sender varchar(500) not null, rack_id bigint references ${s}.rack(id), updated_by varchar(60))`)
      await readerSource(admin, PARCEL_SOURCE, s, ['rack', 'parcel'])
      await admin.post(`/api/table/Data%20Source/${PARCEL_SOURCE}:reflect`, { schema: s, tables: ['rack', 'parcel'], names: { rack: 'Rack', parcel: 'Parcel' } })
    })
    await step('a parcel labelled "Blue box" on the rack "Top"', async () => {
      await outside(`insert into ${s}.rack values (3, 'Top')`)
      await outside(`insert into ${s}.parcel (id, label, weight, fragile, instructions, sent_on, photo, sender, rack_id, updated_by)
        values (7, 'Blue box', 2.5, true, $1, '2026-10-30', 'parcels/blue-box.png', 'Front desk', 3, 'kiosk')`, ['Keep upright.\nOpen from the top.'])
    })
    await step('the user may read parcels and racks', async () => { user = await reader(admin, createUser, ['Parcel', 'Rack']) })
    await step('the user opens that parcel', async () => {
      await openRow('Parcel', '7', user)
      await waitFor(() => expect(document.querySelector('[data-form-field]')).not.toBeNull(), WAIT)
      value = (label: string) => within(screen.getByTestId('form-view')).getByLabelText(label, { exact: true }).closest('[data-form-field]')!.querySelector<HTMLElement>('[data-value]')!
    })
    await step('the user sees its sender on one line', async () => {
      await waitFor(() => expect(value('Sender').textContent!.trim()).toBe('Front desk'), WAIT)
      const sender = value('Sender')
      const oneLine = sender.matches('input, textarea') ? sender.tagName === 'INPUT' : sender.classList.contains('whitespace-nowrap')
      expect(oneLine, 'the sender wraps like long text').toBe(true)
    })
    await step('the user sees its instructions as long text', () => {
      const instructions = value('Instructions')
      const oneLine = instructions.matches('input, textarea') ? instructions.tagName === 'INPUT' : instructions.classList.contains('whitespace-nowrap')
      expect(oneLine, 'the instructions are cut to one line').toBe(false)
    })
  })

  scenario('Only the two ticked databases appear', async ({ admin }, step) => {
    const source = `acc-wh-${randomUUID().slice(0, 8)}`
    await step('the instance\'s token can read five databases, among them "sales" and "stock"', async () => {
      overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
      await openConnect(admin)
    })
    await step('the user ticks "sales" and "stock" and saves the source', async () => {
      const name = screen.getByTestId('connect-name')
      await userEvent.clear(name)
      await userEvent.type(name, source)
      for (const database of ['sales', 'stock']) await userEvent.click(screen.getByTestId(`db-${database}`))
      await onScreen().clickButton('Save and browse tables')
      await screen.findByTestId('warehouse-browser', {}, WAIT)
    })
    await step('browsing the source offers "sales" and "stock" and no other database', () => {
      expect([...browserDatabase().options].map((o) => o.textContent)).toEqual(['sales', 'stock'])
    })
  })

  scenario('Saving stays blocked until a database is ticked', async ({ admin }, step) => {
    await step("the instance's token can read databases", async () => {
      overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
      await openConnect(admin)
    })
    // Nothing is ticked when the page opens.
    await step('the user has ticked no database', () => {
      for (const box of within(screen.getByTestId('connect-databases')).getAllByRole('checkbox')) expect(box).not.toBeChecked()
    })
    await step('the source cannot be saved', () => expect(screen.getByTestId('connect-save')).toBeDisabled())
  })

  scenario('The source and its two databases are listed', async ({ admin }, step) => {
    let source = ''
    await step('a MotherDuck source reading the databases "sales" and "stock"', async () => { source = await givenSource(admin, ['sales', 'stock']) })
    await step('the user looks at the sidebar', () => openAdmin(admin))
    await step('it shows the source with "sales" and "stock" under it', async () => {
      await waitFor(async () => expect(await databasesUnder(source)).toEqual(['sales', 'stock']), WAIT)
    })
  })

  scenario('The filtered catalog and chosen preview stay available', async ({ admin }, step) => {
    await step('the user is previewing "stores" in "main" of "sales" after searching for "STORES"', async () =>
      previewing(admin, await givenSource(admin, ['sales', 'stock']), 'stores', 'main', 'sales', 'STORES'))
    await step('the user returns to the warehouse catalog', showCatalog)
    await step('the catalog still shows only "stores" in "main" of "sales" for the search "STORES"', async () => {
      expect(await catalogContext()).toEqual({ database: 'sales', schema: 'main', query: 'STORES', tables: ['stores'] })
    })
    await step('the user can reopen the preview of "stores" without choosing it again', async () => {
      await userEvent.click(previewTab('stores'))
      await inside(onScreen(), 'preview-size', (el) => el.assertText('rows'))
      expect(previewTab('stores')).toHaveAttribute('aria-selected', 'true')
      expect(previewTitle()).toBe('stores')
    })
  })

  scenario('Returning from copy setup restores the chosen preview', async ({ admin }, step) => {
    await step('the user is previewing "stores" in "main" of "sales" after searching for "STORES"', async () =>
      previewing(admin, await givenSource(admin, ['sales', 'stock']), 'stores', 'main', 'sales', 'STORES'))
    await step('the user opens copy setup and follows the breadcrumb back to "stores"', async () => {
      const copy = await openCopy()
      const back = within(copy).getByRole('link', { name: 'stores' }).getAttribute('href')!
      await visit(back, admin)
      await screen.findByTestId('warehouse-browser', {}, WAIT)
      await screen.findByRole('tab', { name: 'Preview · stores' }, WAIT)
    })
    await step('the same preview of "stores" is selected', async () => {
      expect(previewTab('stores')).toHaveAttribute('aria-selected', 'true')
      await waitFor(() => expect(previewTitle()).toBe('stores'), WAIT)
      await waitFor(() => expect(screen.getByTestId('preview-rows').textContent).toMatch(/Harbour Road/), WAIT)
    })
    await step('the catalog still shows only "stores" in "main" of "sales" for the search "STORES"', async () => {
      expect(await catalogContext()).toEqual({ database: 'sales', schema: 'main', query: 'STORES', tables: ['stores'] })
    })
  })

  scenario('A search for another column keeps the edited copy choices', async ({ admin }, step) => {
    await step('the user has edited the copy mapping for "stores" in "main" of "sales"', async () => {
      await previewing(admin, await givenSource(admin, ['sales', 'stock']), 'stores', 'main', 'sales')
      await openCopy()
      await editColumn('name', { name: 'store_name', label: 'Store title', description: 'Trading name' })
      await omit('city')
    })
    await step('the user searches the mapping for "STATE_CODE"', () => searchMapping('STATE_CODE'))
    await step('only the mapping for "state_code" is offered', () => {
      expect(screen.getAllByRole('textbox', { name: /^Name for / }).map((box) => box.getAttribute('aria-label')!.slice('Name for '.length))).toEqual(['state_code'])
    })
    await step('clearing the mapping search restores the edited name and omitted city', async () => {
      await searchMapping('')
      expect(mappingColumn('name')).toEqual({ name: 'store_name', label: 'Store title', description: 'Trading name', keep: true })
      expect(mappingColumn('city').keep).toBe(false)
    })
  })

  scenario('Submitting copy setup creates editable native rows', async ({ admin }, step) => {
    let w: Warehouse
    // The scenario's table of columns to keep.
    const KEEP = [
      { Source: 'code', Name: 'store_code', Label: 'Store code', Description: 'Warehouse identifier' },
      { Source: 'name', Name: 'store_name', Label: 'Trading name', Description: 'Warehouse trading name' },
      { Source: 'state_code', Name: 'state_code', Label: 'State code', Description: 'Warehouse state' },
    ]
    await step('a warehouse table containing three stores', async () => { w = await storeWarehouse(admin) })
    await step('the user creates a native copy keeping these columns', async () => {
      await previewing(admin, w.source, w.table, 'main', 'sales')
      await openCopy()
      for (const row of KEEP) await editColumn(row.Source, { name: row.Name, label: row.Label, description: row.Description })
      await omit('city')
      const name = screen.getByTestId('copy-name')
      await userEvent.clear(name)
      await userEvent.type(name, w.native)
      await userEvent.selectOptions(screen.getByTestId('copy-key'), 'code')
      await waitFor(() => expect(screen.getByTestId('copy-create')).toBeEnabled(), WAIT)
      await userEvent.click(screen.getByTestId('copy-create'))
      await screen.findByTestId('list-view', {}, WAIT)
    })
    await step('the native copy lists stores "S001", "S002" and "S003"', async () => {
      await waitFor(async () => expect((await nativeRowIds()).sort()).toEqual(['S001', 'S002', 'S003']), WAIT)
    })
    await step('its ordinary row form uses the approved labels without the omitted city', async () => {
      await openRow(w.native, 'S001', admin)
      await waitFor(() => { for (const label of ['Store code', 'Trading name', 'State code']) expect(byLabel(label)).toBeInTheDocument() }, WAIT)
      expect(within(screen.getByTestId('form-view')).queryByLabelText('city', { exact: true })).toBeNull()
      await onScreen().within(byTestId('form-view'), (form) => form
        .assertValue('Store code', 'S001')
        .assertValue('Trading name', 'Harbour Road'))
    })
    await step('a correction made in that form is saved', async () => {
      await onScreen().within(byTestId('form-view'), (form) => form.fillIn('Trading name', 'Native trading correction'))
      await userEvent.click(screen.getByTestId('form-save'))
      await inside(onScreen(), 'form-status', (status) => status.assertExactText('Saved'))
      expect(await formValue(w.native, 'S001', 'Trading name', admin)).toBe('Native trading correction')
    })
  }, 60_000)

  scenario('Copy again updates an unedited store and adds a new store', async ({ admin }, step) => {
    let w: Warehouse
    await step("a native store copy with a person's correction to store \"S002\"", async () => { w = await correctedCopy(admin, 'S002') })
    await step('the warehouse changes the unedited store "S001" and adds store "S004"', () => warehouseChanges(admin, w))
    await step('the user chooses Copy again on the native copy', async () => {
      const answer = await copyAgain(admin, w.native)
      expect(answer.status < 300, `copy again refused: ${answer.status} ${JSON.stringify(answer.body)}`).toBe(true)
      await screen.findByTestId('copy-result', {}, WAIT)
    })
    await step('store "S001" has the changed warehouse name', async () => expect(await formValue(w.native, 'S001', 'Trading name', admin)).toBe('Harbour Road renewed'))
    await step('store "S004" is available as an ordinary native row', async () => {
      expect(await formValue(w.native, 'S004', 'Store code', admin)).toBe('S004')
      expect(byLabel('Trading name').value).toBe('New Quay')
      expect(byLabel('State code').value).toBe('07')
    })
    await step("store \"S002\" still has the person's correction", async () => expect(await formValue(w.native, 'S002', 'State code', admin)).toBe('32'))
  }, 60_000)

  scenario('A refused new store leaves the earlier source changes unapplied', async ({ admin }, step) => {
    let w: Warehouse
    let failure: Awaited<ReturnType<typeof copyAgain>>
    await step("a native store copy with a person's correction to store \"S002\"", async () => { w = await correctedCopy(admin, 'S002') })
    await step('the warehouse changes the unedited store "S001" and adds store "S004"', () => warehouseChanges(admin, w))
    await step('the native copy refuses the new store "S004"', () => admin.post('/api/save_row', { table: 'Server Script', row: {
      row_id: `refuse-${w.native}`, script_type: 'Document Event', ref_table: w.native, event: 'before_save', enabled: true,
      script: 'if (doc.store_code === "S004") throw new Error("Store refused")',
    } }))
    await step('the user attempts Copy again on the native copy', async () => { failure = await copyAgain(admin, w.native) })
    await step('the failed copy explains that no rows changed', async () => {
      expect(failure.status).toBe(417)
      expect(failure.body.error?.message ?? '').toMatch(/no rows changed.*Store refused/)
      await waitFor(() => expect(within(screen.getByTestId('copy-bar')).getByText(/Copy failed; no rows changed/)).toBeVisible(), WAIT)
    })
    await step('the original three stores remain without the new warehouse changes', () => originalStores(admin, w.native))
    await step("store \"S002\" still has the person's correction", async () => expect(await formValue(w.native, 'S002', 'State code', admin)).toBe('32'))
  }, 60_000)

  scenario('Copy again follows renamed native columns', async ({ admin }, step) => {
    let w: Warehouse
    await step("a native store copy with a person's correction to store \"S002\"", async () => { w = await correctedCopy(admin, 'S002') })
    await step('the copied key and trading-name columns have been renamed', async () => {
      await admin.post(`/api/table_def/${enc(w.native)}/rename_column`, { from: 'store_code', to: 'warehouse_code' })
      await admin.post(`/api/table_def/${enc(w.native)}/rename_column`, { from: 'store_name', to: 'trading_name' })
    })
    await step('the warehouse changes the unedited store "S001" and adds store "S004"', () => warehouseChanges(admin, w))
    await step('the user chooses Copy again on the native copy', async () => {
      const answer = await copyAgain(admin, w.native)
      expect(answer.status < 300, `copy again refused: ${answer.status} ${JSON.stringify(answer.body)}`).toBe(true)
      await screen.findByTestId('copy-result', {}, WAIT)
    })
    await step('the renamed columns contain the updated and added stores', async () => {
      const changed = await admin.get<Record<string, unknown>>(`/api/table/${enc(w.native)}/S001`)
      const added = await admin.get<Record<string, unknown>>(`/api/table/${enc(w.native)}/S004`)
      expect(changed.trading_name).toBe('Harbour Road renewed')
      expect(added.warehouse_code).toBe('S004')
      expect(added.trading_name).toBe('New Quay')
      expect(Object.hasOwn(added, 'store_code')).toBe(false)
      expect(Object.hasOwn(added, 'store_name')).toBe(false)
    })
    await step("store \"S002\" still has the person's correction", async () => expect(await formValue(w.native, 'S002', 'State code', admin)).toBe('32'))
  }, 60_000)

  scenario('Undo restores the rows changed by Copy again', async ({ admin }, step) => {
    let w: Warehouse
    await step("a native store copy with a person's correction to store \"S002\"", async () => { w = await correctedCopy(admin, 'S002') })
    await step('the warehouse changes the unedited store "S001" and adds store "S004"', () => warehouseChanges(admin, w))
    await step('the user copies again and undoes that copy from its import history', async () => {
      const answer = await copyAgain(admin, w.native)
      expect(answer.status < 300, `copy again refused: ${answer.status} ${JSON.stringify(answer.body)}`).toBe(true)
      await screen.findByTestId('copy-result', {}, WAIT)
      await visit('/featherbase/admin/imports', admin)
      expect((await screen.findAllByTestId(`ib-target-${w.native}`, {}, WAIT))[0]).toBeInTheDocument()
      await visit(`/featherbase/admin/import?table=${enc(w.native)}`, admin)
      await userEvent.click(await screen.findByTestId('iw-revert-open-h0', {}, WAIT))
      await userEvent.click(await screen.findByTestId('iw-revert-confirm-h0', {}, WAIT))
      await screen.findByTestId('iw-revert-result-h0', {}, WAIT)
    })
    await step('the original three stores remain without the new warehouse changes', () => originalStores(admin, w.native))
    await step("store \"S002\" still has the person's correction", async () => expect(await formValue(w.native, 'S002', 'State code', admin)).toBe('32'))
  }, 60_000)

  scenario('The browser opens on the last schema', async ({ admin }, step) => {
    let source = ''
    await step('the user last browsed the schema "main" of the database "stock"', async () => {
      source = await givenSource(admin, ['sales', 'stock'])
      await openBrowser(source, admin)
      await pickDatabase('stock')
      await pickSchema('main')
    })
    await step('the user opens the source again', async () => {
      await openBrowser(source, admin)
      await screen.findByTestId('warehouse-browser', {}, WAIT)
    })
    await step('the browser opens on the schema "main" of "stock"', async () => {
      await waitFor(async () => expect(await place()).toEqual({ database: 'stock', schema: 'main' }), WAIT)
    })
  })

  scenario('A table added since shows after a refresh', async ({ admin }, step) => {
    await step('the table list of "sales" was read before the table "regions" was added', async () => {
      const source = await givenSource(admin, ['sales', 'stock'])
      await openBrowser(source, admin)
      await pickDatabase('sales')
      await showCatalog()
      expect(await catalogTables()).not.toContain('regions')
      await addStandinTable(standin, 'sales', 'regions')
    })
    await step('the user refreshes the table list of "sales"', async () => {
      expect((await place()).database).toBe('sales')
      expect(await catalogTables()).not.toContain('regions')
      await onScreen().clickButton('Refresh')
    })
    await step('"regions" is listed', () => waitFor(async () => expect(await catalogTables(), 'regions is not listed').toContain('regions'), WAIT))
  })

  scenario("The token's owner and databases show", async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step("the instance's token can read five databases", () => { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
    await step('the user starts connecting a MotherDuck warehouse', () => openConnect(admin))
    await step('they are told who the token signs in as and that it can read five databases', () => {
      expect(connectResult()).toMatch(/Connected as reader_user · it can read 5 databases/)
    })
    await step('they are not asked for a token', () => expect(document.querySelectorAll('input[type=password]')).toHaveLength(0))
  })

  scenario('A refused token is explained, not echoed', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step("MotherDuck refuses the instance's token", () => { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused) })
    await step('the user starts connecting a MotherDuck warehouse', () => openConnect(admin))
    await step('they are told the token was refused, in plain words', () => expect(connectResult()).toMatch(/MotherDuck refused this server's token/))
    await step('the message does not contain the token', () => expect(connectResult()).not.toContain(STANDIN_TOKENS.refused))
  })

  scenario('An instance with no token says so', async ({ admin }, step) => {
    await step('the user is a System Manager')
    await step('the instance has no MotherDuck token', () => { overrideVariable('MOTHERDUCK_TOKEN', undefined) })
    await step('the user starts connecting a MotherDuck warehouse', () => openConnect(admin))
    await step('they are told the instance has no MotherDuck token', () => expect(connectResult()).toMatch(/MOTHERDUCK_TOKEN is not set/))
    await step('no database is offered', () => expect(screen.queryByTestId('connect-databases')).toBeNull())
  })
})

