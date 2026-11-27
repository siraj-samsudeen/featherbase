// #1409: stand-in datasets, below the spec's scenarios
// (test/scenarios/stand-in-datasets.test.ts): the file check cell by cell, the
// routes' refusals, what a read says and what its response carries, the
// production rule at read time, the binding's own rules, switching when the
// warehouse fails, a stand-in across an app upgrade, and the MCP tools.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { afterAll, describe, expect } from 'vitest'
import { STAND_IN_HEADER, readStandInHeader, type RuntimeReadContext } from 'shared'
import { test as pgTest } from './pg-test'
import { expectRefused, expectStatus } from './fixtures'
import { connectAgent, issueToken } from './agent-driver'
import { sql } from '../src/db'
import { withNamedVariable } from '../src/env'
import { appSetupState } from '../src/app-settings'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { invalidateSources } from '../src/sources/registry'
import { activeSnapshot, buildSnapshot, pendingMisses } from '../src/dataset-snapshot'
import { datasetBinding } from '../src/dataset-bindings'
import { datasetsDue } from '../src/jobs/refresh-datasets'
import { STAND_IN_PROBLEMS_SHOWN, checkStandIn } from '../src/dataset-stand-in'
import { registerAppDatasets, type DatasetDeclaration } from '../src/app-datasets'
import {
  FIXTURE, READ, TARGETS, TARGETS_CSV, TARGET_ROWS, SALES_ROWS, WAREHOUSE_TARGETS, WAREHOUSE_TARGET_ROWS,
  ask, loadTargets, pinned, storeSales, useWarehouse, warehouseTargets,
} from './stand-in-fixture'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
useWarehouse()

const BINDING = '/api/table/Dataset%20Binding'
type Switched = { switched: boolean; message: string; rows?: number }
type Listed = { apps: { app: string; title: string; datasets: Record<string, unknown>[] }[] }
const post = (client: TestClient, path: string, body: unknown) => client.fetch(path, { method: 'POST', body: JSON.stringify(body) })
const onProduction = <T>(work: () => Promise<T>) => withNamedVariable('FEATHERBASE_ENV', 'production', work)

describe('checking a file against a dataset\'s declaration', () => {
  const stock: DatasetDeclaration = {
    name: 'stock', source: 'warehouse', query: 'select 1',
    columns: [
      { name: 'store', type: 'text' }, { name: 'sku', type: 'integer' }, { name: 'counted_on', type: 'date' },
      { name: 'value', type: 'money' }, { name: 'weight', type: 'number' }, { name: 'units', type: 'integer' },
      { name: 'damaged', type: 'boolean' }, { name: 'remark', type: 'text' },
    ],
    keys: ['sku'], filters: { store: 'store' },
  }
  const header = 'store,sku,counted_on,value,weight,units,damaged,remark'

  test('a file that fits is read as its rows, empty cells as missing values and blank lines left out', () => {
    const check = checkStandIn(stock, `﻿${header}\n N1 ,9007199254740993,2026-11-20,1250.50,0.75,12,False,\n\n,,,,,,,\nS1,42,2026-11-21,,,,,recount\n`)
    expect(check).toEqual({ problems: [], problemCount: 0, rows: [
      { store: 'N1', sku: '9007199254740993', counted_on: '2026-11-20', value: '1250.50', weight: '0.75', units: '12', damaged: 'false', remark: null },
      { store: 'S1', sku: '42', counted_on: '2026-11-21', value: null, weight: null, units: null, damaged: null, remark: 'recount' },
    ] })
  })

  test('reads a file whose cells are separated by semicolons or tabs', () => {
    const row = ['N1', '7', '2026-11-20', '10', '1', '2', 'true', 'ok']
    for (const delimiter of [';', '\t'] as const)
      expect(checkStandIn(stock, `${header.replaceAll(',', delimiter)}\n${row.join(delimiter)}`, delimiter)).toMatchObject({ problemCount: 0, rows: [{ store: 'N1', sku: '7' }] })
  })

  test('each wrong value is named by its row and column, in the words of its type', () => {
    const check = checkStandIn(stock, [header,
      'N1,7.5,20-11-2026,"1,250.50",heavy,3.5,yes,fine',
      'S1,8,2026-11-21,10,1,2,true,short row'.split(',').slice(0, 3).join(','),
    ].join('\n'))
    expect(check.problems).toEqual([
      { row: 2, column: 'sku', message: 'Row 2: "sku" holds "7.5", which is not a whole number' },
      { row: 2, column: 'counted_on', message: 'Row 2: "counted_on" holds "20-11-2026", which is not a date written YYYY-MM-DD' },
      { row: 2, column: 'value', message: 'Row 2: "value" holds "1,250.50", which is not an amount (digits only, like 1250.50)' },
      { row: 2, column: 'weight', message: 'Row 2: "weight" holds "heavy", which is not a number' },
      { row: 2, column: 'units', message: 'Row 2: "units" holds "3.5", which is not a whole number' },
      { row: 2, column: 'damaged', message: 'Row 2: "damaged" holds "yes", which is not true or false' },
    ])
    // A row that stops short leaves its other cells empty, which a value column may be.
    expect(check.rows[1]).toEqual({ store: 'S1', sku: '8', counted_on: '2026-11-21', value: null, weight: null, units: null, damaged: null, remark: null })
  })

  test('a date must be a real day and nothing more', () => {
    expect(checkStandIn(stock, `${header}\nN1,7,2026-02-31,10,1,2,true,\nN1,8,2026-11-20T10:30,10,1,2,true,\nN1,9,2026-13-01,10,1,2,true,`).problems.map(p => p.message)).toEqual([
      'Row 2: "counted_on" holds "2026-02-31", which is not a date written YYYY-MM-DD',
      'Row 3: "counted_on" holds "2026-11-20T10:30", which is not a date written YYYY-MM-DD',
      'Row 4: "counted_on" holds "2026-13-01", which is not a date written YYYY-MM-DD',
    ])
  })

  test('an empty key or scope cell is refused: that row would reach no one', () => {
    expect(checkStandIn(stock, `${header}\n,7,2026-11-20,10,1,2,true,\nN1,,2026-11-20,10,1,2,true,`).problems).toEqual([
      { row: 2, column: 'store', message: 'Row 2: "store" is empty, and every row of stock needs it' },
      { row: 3, column: 'sku', message: 'Row 3: "sku" is empty, and every row of stock needs it' },
    ])
  })

  test('the columns must be exactly the dataset\'s: none missing, none extra, none twice', () => {
    expect(checkStandIn(stock, 'store,sku,counted_on,value,weight,units,damaged,store,Remark,\nN1,7,2026-11-20,10,1,2,true,N1,x,').problems).toEqual([
      { column: 'remark', message: 'The file has no column "remark", which stock needs' },
      { column: 'store', message: 'The file has the column "store" more than once' },
      { column: 'Remark', message: 'The file\'s column "Remark" is not a column of stock' },
    ])
  })

  test('a file with no rows, or no text at all, is refused', () => {
    expect(checkStandIn(stock, `${header}\n\n`).problems).toEqual([{ message: 'The file has no rows under its header' }])
    const empty = checkStandIn(stock, '')
    expect(empty.problemCount).toBe(stock.columns.length + 1)
    expect(empty.problems.at(-1)).toEqual({ message: 'The file has no rows under its header' })
  })

  test('only the first problems are spelled out; all are counted', () => {
    const check = checkStandIn(stock, [header, ...Array.from({ length: STAND_IN_PROBLEMS_SHOWN + 5 }, () => 'N1,x,2026-11-20,10,1,2,true,')].join('\n'))
    expect(check.problems).toHaveLength(STAND_IN_PROBLEMS_SHOWN)
    expect(check.problemCount).toBe(STAND_IN_PROBLEMS_SHOWN + 5)
  })
})

describe('the routes', () => {
  test('only a System Manager may list, check, load or switch', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await expectStatus(await reader.fetch('/api/datasets'), 403)
    for (const verb of ['check_stand_in', 'load_stand_in', 'switch_to_warehouse'])
      await expectStatus(await post(reader, TARGETS + verb, { csv: TARGETS_CSV }), 403)
    expect(await datasetBinding('storesales.targets')).toBeNull()
  })

  test('a request that is not a file is refused in words', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const expected = 'Expected { csv } holding the file as CSV text'
    await expectRefused(await admin.fetch(`${TARGETS}check_stand_in`, { method: 'POST', body: 'not json' }), 417, expected)
    for (const body of [{}, { csv: 7 }, { csv: TARGETS_CSV, delimiter: '|' }, { csv: TARGETS_CSV, note: 7 }, { csv: TARGETS_CSV, expected_by: 20261215 }])
      await expectRefused(post(admin, `${TARGETS}load_stand_in`, body), 417, expected)
  })

  test('an app that is not installed, or a dataset it does not declare, is named', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await expectRefused(admin.post('/api/datasets/nosuchapp/targets/check_stand_in', { csv: TARGETS_CSV }), 404, 'App nosuchapp is not installed')
    await expectRefused(admin.post('/api/datasets/storesales/budgets/load_stand_in', { csv: TARGETS_CSV }), 404,
      'App storesales does not declare the dataset budgets (it declares: sales, targets)')
    await expectRefused(admin.post('/api/datasets/storesales/budgets/switch_to_warehouse', {}), 404, 'does not declare the dataset budgets')
  })

  test('a check says whether the file fits and what to fix, and writes nothing', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    expect(await admin.post(`${TARGETS}check_stand_in`, { csv: TARGETS_CSV })).toEqual({ app: 'storesales', dataset: 'targets', fits: true, rows: 3, problems: [], problem_count: 0 })
    const semicolons = await admin.post(`${TARGETS}check_stand_in`, { csv: TARGETS_CSV.replaceAll(',', ';'), delimiter: ';' })
    expect(semicolons).toMatchObject({ fits: true, rows: 3 })
    expect(await admin.post(`${TARGETS}check_stand_in`, { csv: 'store,month,target,units,confirmed\nN1,November,10,1,true' })).toMatchObject({
      fits: false, rows: 1, problem_count: 1,
      problems: [{ row: 2, column: 'month', message: 'Row 2: "month" holds "November", which is not a date written YYYY-MM-DD' }],
    })
    expect(await activeSnapshot('storesales.targets')).toBeNull()
    expect(await datasetBinding('storesales.targets')).toBeNull()
  })

  test('a refusal with many problems spells out the first and counts the rest', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const csv = ['store,month,target,units,confirmed', ...Array.from({ length: STAND_IN_PROBLEMS_SHOWN + 3 }, () => 'N1,2026-11-01,ten,1,true')].join('\n')
    const refused = await expectRefused(admin.post(`${TARGETS}load_stand_in`, { csv }), 417)
    expect(refused.message).toContain('Row 2: "target" holds "ten", which is not an amount')
    expect(refused.message).toMatch(/\. And 3 more\.$/)
  })

  test('a System Manager sees every app\'s datasets and where each is served from', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const before = (await admin.get<Listed>('/api/datasets')).apps
    expect(before).toEqual([{ app: 'storesales', title: 'Store Sales', datasets: [
      { name: 'sales', source: 'storesales-warehouse', binding: null, served_from: 'Warehouse', stand_in: false, note: null, expected_by: null,
        allowed_on_production: false, rows: null, as_of: null, loaded_by: null, snapshot: null },
      expect.objectContaining({ name: 'targets', binding: null, served_from: 'Warehouse', rows: null }),
    ] }])
    await buildSnapshot('storesales.sales')
    const loaded = await loadTargets(admin, { note: 'From the planning workbook', expected_by: '2026-12-15' })
    const [{ datasets }] = (await admin.get<Listed>('/api/datasets')).apps
    expect(datasets[0]).toMatchObject({ name: 'sales', served_from: 'Warehouse', stand_in: false, rows: 2, loaded_by: null })
    expect(datasets[1]).toEqual({
      name: 'targets', source: 'storesales-warehouse', binding: 'storesales.targets', served_from: 'Stand-in', stand_in: true,
      note: 'From the planning workbook', expected_by: '2026-12-15', allowed_on_production: false, rows: 3, as_of: loaded.loaded_at,
      loaded_by: admin.user, snapshot: (await activeSnapshot('storesales.targets'))!.row_id,
    })
  })

  test('an installed app that declares no dataset is left out of the list', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    expect(await discoverPackages([FIXTURE, resolve('../..', 'test-apps/fixtures/place-roster')])).toEqual([])
    await admin.post('/api/install_app', { name: 'placeroster' })
    expect((await admin.get<Listed>('/api/datasets')).apps.map(({ app }) => app)).toEqual(['storesales'])
  })

  test('loading again replaces the stand-in, and keeps its note when none is given', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin, { note: 'First cut' })
    await admin.post(`${TARGETS}load_stand_in`, { csv: 'store,month,target,units,confirmed\nN1,2026-12-01,10,1,' })
    expect(await ask(reader, 'targets')).toMatchObject({
      served: 'stand-in', standIn: { note: 'First cut', expectedBy: null },
      rows: [{ store: 'N1', month: '2026-12-01', target: 10, units: 1, confirmed: null }],
    })
    await admin.post(`${TARGETS}load_stand_in`, { csv: TARGETS_CSV, note: null })
    expect((await ask(reader, 'targets'))?.standIn).toEqual({ note: null, expectedBy: null })
    // The stand-in before the last is kept as the last good copy; older ones go.
    expect(await sql`select state, stand_in from dataset_snapshot where dataset = 'storesales.targets' order by state`)
      .toEqual([{ state: 'active', stand_in: true }, { state: 'superseded', stand_in: true }])
  })

  test('a load that cannot activate is refused with the reason, never reported as loaded', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    // As while the server is discovering its apps again: installed, not yet registered.
    registerAppDatasets('storesales')
    await expectRefused(loadTargets(admin), 417, 'The stand-in for targets could not be loaded: no dataset registered as storesales.targets')
    // The binding goes back to what it was, so the dataset is not left unrefreshed for good.
    expect(await datasetBinding('storesales.targets')).toMatchObject({ served_from: 'Warehouse', note: null })
    expect(await discoverPackages([FIXTURE])).toEqual([])
    await loadTargets(admin, { note: 'First cut', expected_by: '2026-12-15' })
    registerAppDatasets('storesales')
    await expectRefused(loadTargets(admin, { note: 'Second cut', expected_by: null }), 417, 'could not be loaded')
    expect(await datasetBinding('storesales.targets')).toMatchObject({ served_from: 'Stand-in', note: 'First cut', expected_by: '2026-12-15' })
    expect(await discoverPackages([FIXTURE])).toEqual([])
  })

  test('a refresh already on its way does not replace a stand-in loaded meanwhile', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    await warehouseTargets(WAREHOUSE_TARGETS)
    // The job listed the dataset as due before the load; the build itself looks again.
    expect(await buildSnapshot('storesales.targets', { trigger: 'schedule' })).toEqual({ status: 'skipped', reason: 'the dataset is bound to a stand-in' })
    expect(await sql`select count(*)::int as builds from dataset_snapshot where dataset = 'storesales.targets'`).toEqual([{ builds: 1 }])
    expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
  })
})

describe('a read of a stand-in', () => {
  test('its response names the stand-in in one header; a response without stand-in rows has none', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await buildSnapshot('storesales.sales')
    const loaded = await loadTargets(admin, { note: 'Workbook – திட்டம்', expected_by: '2026-12-15' })
    const both = await post(reader, `${READ}overview`, { payload: {} })
    expect(readStandInHeader(both.headers.get(STAND_IN_HEADER)))
      .toEqual([{ app: 'storesales', dataset: 'targets', loaded_at: loaded.loaded_at, note: 'Workbook – திட்டம்', expected_by: '2026-12-15' }])
    const { result } = await both.json() as { result: { sales: { served: string; rows: unknown[] }; targets: { served: string } } }
    expect(result.sales).toMatchObject({ served: 'cached', rows: SALES_ROWS })
    expect(result.sales).not.toHaveProperty('standIn')
    expect(result.targets.served).toBe('stand-in')
    const salesOnly = await post(reader, `${READ}sales`, { payload: {} })
    await expectStatus(salesOnly, 200)
    expect(salesOnly.headers.get(STAND_IN_HEADER)).toBeNull()
  })

  test('a filter on a declared key narrows a stand-in as it narrows the warehouse\'s rows', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    expect((await ask(reader, 'targets', { filters: { store: ['N1', 'S1'] } }))?.rows).toEqual(TARGET_ROWS.slice(1))
  })

  test('a live read of a stand-in answers the stand-in, marked the same way (D5)', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser, { source: false })
    const loaded = await loadTargets(admin, { note: 'From the planning workbook' })
    const answered = await post(reader, `${READ}ask_outbound`, { payload: { dataset: 'targets', how: 'live' } })
    expect((await answered.json() as { result: unknown }).result).toEqual({
      dataset: 'targets', served: 'stand-in', at: loaded.loaded_at, standIn: { note: 'From the planning workbook', expectedBy: null }, rows: TARGET_ROWS,
    })
    expect(readStandInHeader(answered.headers.get(STAND_IN_HEADER))).toHaveLength(1)
    // As before the stand-in: only an outbound read may ask live.
    await expectRefused(reader.post(`${READ}ask`, { payload: { dataset: 'targets', how: 'live' } }), 417, 'declare the read outbound')
  })

  test('a dataset bound to a stand-in that nobody has loaded answers nothing, and asks for no refresh', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser, { source: false })
    await admin.post(BINDING, { row_id: 'storesales.targets', served_from: 'Stand-in' })
    expect(await ask(reader, 'targets')).toBeNull()
    expect(await pendingMisses()).not.toContain('storesales.targets')
    await expectRefused(reader.post(`${READ}ask_outbound`, { payload: { dataset: 'targets', how: 'live' } }), 409, 'Store Sales is not set up yet')
  })

  test('a dataset bound to a stand-in while it still holds warehouse rows answers them, live or not', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await buildSnapshot('storesales.sales')
    await admin.post(BINDING, { row_id: 'storesales.sales', served_from: 'Stand-in' })
    expect(await ask(reader, 'sales')).toMatchObject({ served: 'cached', rows: SALES_ROWS })
    expect(await ask(reader, 'sales', { how: 'live' }, 'ask_outbound')).toMatchObject({ served: 'cached', rows: SALES_ROWS })
  })

  test('a live read of a warehouse dataset still asks the warehouse', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    expect(await ask(reader, 'sales', { how: 'live' }, 'ask_outbound')).toMatchObject({ served: 'live', rows: SALES_ROWS })
  })

  test('on production a stand-in loaded elsewhere is not served until it is allowed there (D8)', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    await onProduction(async () => {
      expect(await ask(reader, 'targets')).toBeNull()
      expect(await pendingMisses()).not.toContain('storesales.targets')
      await expectRefused(reader.post(`${READ}ask_outbound`, { payload: { dataset: 'targets', how: 'live' } }), 409, 'not set up yet')
      const { updated_at } = (await datasetBinding('storesales.targets'))!
      await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at, allowed_on_production: true } })
      expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
    })
  })

  test('a dataset bound to a stand-in does not keep its app waiting for a data source', async ({ admin, createUser }) => {
    await storeSales(admin, createUser, { source: false })
    const missing = async () => (await appSetupState()).find(({ app }) => app === 'storesales')?.missing
    expect(await missing()).toEqual(['data source storesales-warehouse'])
    await admin.post(BINDING, { row_id: 'storesales.targets', served_from: 'Stand-in' })
    expect(await missing()).toEqual(['data source storesales-warehouse'])
    await admin.post(BINDING, { row_id: 'storesales.sales', served_from: 'Stand-in' })
    expect(await missing()).toEqual([])
  })
})

// The fixture's datasets are unscoped; a stand-in of a scoped one is limited
// to the reader's places by the same filter as the warehouse's rows.
describe('a stand-in of a dataset that follows people\'s places', () => {
  const proof = resolve('../..', 'test-apps/fixtures/dataset-proof')
  const roster = resolve('../..', 'test-apps/fixtures/place-roster')

  test('a reader gets only the rows of their own store and section', async ({ admin, createUser }) => {
    expect(await discoverPackages([proof, roster])).toEqual([])
    await admin.post('/api/install_app', { name: 'datasetproof' })
    await admin.post('/api/install_app', { name: 'placeroster' })
    const version = { 'X-Featherbase-App-Version': 'datasetproof@1.0.0' }
    const created = await createUser({ email: 'kids@example.test', roles: ['Dataset Reader'] })
    const reader = makeClient({ request: (path, init) => created.fetch(String(path), { ...init, headers: { ...init?.headers, ...version } }) }, created.token, created.user)
    await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: 'kids-north', person: reader.user, place: 'North / Kids', store: 'N1', section: 'kids' } })
    await admin.post('/api/datasets/datasetproof/sales/load_stand_in', { csv: [
      'plant_code,section_code,business_day,amount,units,note',
      'N1,kids,2026-11-01,100.50,3,north kids', 'N1,mens,2026-11-01,300,5,north mens', 'S1,kids,2026-11-01,40,2,south kids',
    ].join('\n') })
    const digest = availableRuntimeVersions().find(p => p.name === 'datasetproof')!.digest
    const app = await import(`${pathToFileURL(resolve(proof, 'server.mjs')).href}?artifact=${digest}`)
    app.hooks.run = (context: RuntimeReadContext) => context.datasets.active('sales')
    const answer = await reader.post<{ result: { served: string; rows: unknown[] } }>('/api/app_reads/datasetproof/inside', { payload: {} })
    expect(answer.result).toMatchObject({ served: 'stand-in', rows: [
      { plant_code: 'N1', section_code: 'kids', business_day: '2026-11-01', amount: 100.5, units: 3, note: 'north kids' },
    ] })
  })
})

describe('switching to the warehouse', () => {
  test('a dataset that is not on a stand-in is refused', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await expectRefused(admin.post(`${TARGETS}switch_to_warehouse`, {}), 417, 'targets already reads the warehouse')
    await buildSnapshot('storesales.sales')
    await expectRefused(admin.post('/api/datasets/storesales/sales/switch_to_warehouse', {}), 417, 'sales already reads the warehouse')
  })

  test('a warehouse that cannot be reached leaves the stand-in serving and bound, and says why', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser, { source: false })
    await loadTargets(admin)
    const switched = await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})
    expect(switched).toEqual({ app: 'storesales', dataset: 'targets', switched: false,
      message: 'targets stays on its stand-in. The warehouse refresh failed: Data Source storesales-warehouse not found.' })
    expect((await datasetBinding('storesales.targets'))?.served_from).toBe('Stand-in')
    expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
  })

  test('one row is one row', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await loadTargets(admin)
    await warehouseTargets(WAREHOUSE_TARGETS.slice(0, 1))
    expect((await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})).message).toBe('targets now reads the warehouse: 1 row.')
  })

  test('a binding set to Warehouse by hand: the stand-in serves, marked, until the next refresh, which compares with nothing (D2, D3)', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    await warehouseTargets(WAREHOUSE_TARGETS)
    const { updated_at } = (await datasetBinding('storesales.targets'))!
    await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at, served_from: 'Warehouse' } })
    expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
    expect(await datasetsDue()).toContain('storesales.targets')
    // The warehouse's total is a tenth of the stand-in's; the 10% drop guard has no baseline.
    expect(await buildSnapshot('storesales.targets')).toMatchObject({ status: 'activated', rowCount: 2 })
    expect(await ask(reader, 'targets')).toMatchObject({ served: 'cached', rows: WAREHOUSE_TARGET_ROWS })
    // From here the guard compares real with real.
    await warehouseTargets(WAREHOUSE_TARGETS.slice(0, 1))
    expect(await buildSnapshot('storesales.targets')).toMatchObject({ status: 'refused', reason: expect.stringContaining('target total dropped 40%') })
  })

  test('the same, switched at once instead of waiting for the refresh', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await loadTargets(admin)
    await warehouseTargets(WAREHOUSE_TARGETS)
    const { updated_at } = (await datasetBinding('storesales.targets'))!
    await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at, served_from: 'Warehouse' } })
    expect(await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})).toMatchObject({ switched: true, rows: 2 })
    // And when the warehouse cannot answer, a binding that was Warehouse stays Warehouse.
    await loadTargets(admin)
    const again = (await datasetBinding('storesales.targets'))!
    await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at: again.updated_at, served_from: 'Warehouse' } })
    await warehouseTargets([])
    expect(await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})).toMatchObject({ switched: false })
    expect((await datasetBinding('storesales.targets'))?.served_from).toBe('Warehouse')
  })
})

describe('the Dataset Binding Table', () => {
  test('a row is named <app>.<dataset> for a dataset an installed app declares', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await expectRefused(admin.post(BINDING, { row_id: 'Targets', served_from: 'Warehouse' }), 417, 'A dataset binding is named <app>.<dataset>')
    await expectRefused(admin.post(BINDING, { row_id: 'nosuchapp.targets', served_from: 'Warehouse' }), 417, 'App nosuchapp is not installed')
    await expectRefused(admin.post(BINDING, { row_id: 'storesales.budgets', served_from: 'Warehouse' }), 417,
      'App storesales does not declare the dataset budgets (it declares: sales, targets)')
    expect(await admin.post(BINDING, { row_id: 'storesales.targets', served_from: 'Warehouse', app: 'other', dataset: 'other' }))
      .toMatchObject({ row_id: 'storesales.targets', app: 'storesales', dataset: 'targets', served_from: 'Warehouse', allowed_on_production: false })
  })

  test('a binding of an app that declares no dataset says so plainly', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    expect(await discoverPackages([FIXTURE, resolve('../..', 'test-apps/fixtures/place-roster')])).toEqual([])
    await admin.post('/api/install_app', { name: 'placeroster' })
    const refused = await expectRefused(admin.post(BINDING, { row_id: 'placeroster.targets', served_from: 'Warehouse' }), 417, 'App placeroster does not declare the dataset targets')
    expect(refused.message).not.toContain('it declares')
  })

  test('its app and dataset never change, and only a System Manager may write it', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    const made = await admin.post<{ updated_at: string }>(BINDING, { row_id: 'storesales.targets', served_from: 'Warehouse' })
    expect(await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at: made.updated_at, app: 'other', dataset: 'sales', note: 'kept' } }))
      .toMatchObject({ app: 'storesales', dataset: 'targets', note: 'kept' })
    await expectStatus(await post(reader, BINDING, { row_id: 'storesales.sales', served_from: 'Stand-in' }), 403)
  })

  test('on production a binding to a stand-in is refused until it is allowed on that binding', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    await onProduction(async () => {
      await expectRefused(admin.post(BINDING, { row_id: 'storesales.targets', served_from: 'Stand-in' }), 417,
        'tick Allowed on production on the Dataset Binding storesales.targets')
      expect(await admin.post(BINDING, { row_id: 'storesales.targets', served_from: 'Stand-in', allowed_on_production: true }))
        .toMatchObject({ served_from: 'Stand-in', allowed_on_production: true })
    })
  })

  test('on production, unticking the box stops the stand-in being served, and a switch that fails does not bind it back', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await onProduction(async () => {
      await admin.post(BINDING, { row_id: 'storesales.targets', allowed_on_production: true })
      await loadTargets(admin)
      expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in' })
      const { updated_at } = (await datasetBinding('storesales.targets'))!
      expect(await admin.post('/api/save_row', { table: 'Dataset Binding', row: { row_id: 'storesales.targets', updated_at, allowed_on_production: false } }))
        .toMatchObject({ served_from: 'Stand-in', allowed_on_production: false })
      expect(await ask(reader, 'targets')).toBeNull()
      // The warehouse has no targets: the refresh is refused, and the dataset stays bound to the warehouse.
      expect(await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})).toMatchObject({ switched: false })
      expect((await datasetBinding('storesales.targets'))?.served_from).toBe('Warehouse')
    })
  })

  test('the settings file cannot allow a stand-in on production', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const file = { settings: { 'Dataset Binding': [{ row_id: 'storesales.targets', served_from: 'Stand-in', allowed_on_production: true }] } }
    await expectRefused(admin.post('/api/instance-settings/apply', { file }), 417, 'allowed_on_production')
    expect(await datasetBinding('storesales.targets')).toBeNull()
  })

  test('a binding the settings file manages is switched in the file: the switch is refused before anything is built (D7)', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await admin.post('/api/instance-settings/apply', { file: { settings: { 'Dataset Binding': [{ row_id: 'storesales.targets', served_from: 'Stand-in' }] } } })
    await loadTargets(admin, { note: 'From the planning workbook' })
    await warehouseTargets(WAREHOUSE_TARGETS)
    await expectRefused(admin.post(`${TARGETS}switch_to_warehouse`, {}), 403, 'instance settings file')
    expect(await sql`select count(*)::int as builds from dataset_snapshot where dataset = 'storesales.targets'`).toEqual([{ builds: 1 }])
    expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', standIn: { note: 'From the planning workbook' } })
  })
})

describe('a stand-in when the app\'s declaration changes (D4)', () => {
  const copies: string[] = []
  afterAll(() => Promise.all(copies.map(copy => rm(copy, { recursive: true, force: true }))))

  /** Upgrade Store Sales to `version`, its targets dataset changed by `change`. */
  async function upgradeTargets(admin: TestClient, version: string, change: (targets: Record<string, unknown>) => Record<string, unknown>) {
    const upgraded = await mkdtemp(resolve('test/.stand-in-proof-'))
    copies.push(upgraded)
    await cp(FIXTURE, upgraded, { recursive: true })
    const manifest = JSON.parse(await readFile(resolve(upgraded, 'featherbase.json'), 'utf8'))
    manifest.datasets[1] = change(manifest.datasets[1])
    manifest.migrations = [{ id: `targets_${version.replaceAll('.', '_')}`, fromVersion: '1.0.0', toVersion: version, operations: [] }]
    await writeFile(resolve(upgraded, 'featherbase.json'), JSON.stringify(manifest))
    await writeFile(resolve(upgraded, 'package.json'), JSON.stringify({ name: 'featherbase-stand-in-proof', version, type: 'module' }))
    expect(await discoverPackages([FIXTURE, upgraded])).toEqual([])
    const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'storesales', version })
    await admin.post('/api/upgrade_app', { name: 'storesales', version, planId: plan.planId })
    await admin.post('/api/activate_app_upgrade', { name: 'storesales', version })
  }
  const reading = (client: TestClient, version: string) => makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `storesales@${version}` },
  }) }, client.token, client.user)

  test('a corrected query keeps the stand-in serving', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    await upgradeTargets(admin, '1.1.0', targets => ({ ...targets, query: 'select store, month, target, units, confirmed from standin_proof.targets where target > 0' }))
    expect(await ask(reading(reader, '1.1.0'), 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
  })

  test('a changed column retires it: the file no longer fits what the app reads', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    await loadTargets(admin)
    await upgradeTargets(admin, '1.2.0', targets => ({ ...targets, columns: [...(targets.columns as unknown[]), { name: 'region', type: 'text' }] }))
    expect(await ask(reading(reader, '1.2.0'), 'targets')).toBeNull()
    await expectRefused(reading(admin, '1.2.0').post(`${TARGETS}load_stand_in`, { csv: TARGETS_CSV }), 417, 'The file has no column "region", which targets needs')
    invalidateSources()
  })
})

describe('the MCP tools', () => {
  const file = { app: 'storesales', dataset: 'targets', csv: TARGETS_CSV }

  test('a file that does not fit gets its problems and no check', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const agent = await connectAgent(await issueToken(admin))
    const checked = await agent.ok<Record<string, unknown>>('check_stand_in', { ...file, csv: 'store,month,target,units,confirmed\nN1,2026-11-01,ten,1,true' })
    expect(checked).toMatchObject({ fits: false, problems: [{ row: 2, column: 'target' }] })
    expect(checked).not.toHaveProperty('check')
  })

  test('a check vouches for one file only: another file, or a made-up check, is refused', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const agent = await connectAgent(await issueToken(admin))
    const { check } = await agent.ok<{ check: string }>('check_stand_in', file)
    for (const args of [{ ...file, csv: `${TARGETS_CSV}W1,2026-11-01,5,1,true\n`, check }, { ...file, check: 'made-up' }]) {
      const refused = await agent.call('load_stand_in', args)
      expect(refused.isError).toBe(true)
      expect(refused.content[0].text).toContain('Check the file first')
    }
    expect(await activeSnapshot('storesales.targets')).toBeNull()
  })

  test('an agent loads with a note and a date, lists every app, and switches to the warehouse', async ({ admin, createUser }) => {
    await storeSales(admin, createUser)
    const agent = await connectAgent(await issueToken(admin))
    const semicolons = { ...file, csv: TARGETS_CSV.replaceAll(',', ';'), delimiter: ';' }
    const { check } = await agent.ok<{ check: string }>('check_stand_in', semicolons)
    await agent.ok('load_stand_in', { ...semicolons, check, note: 'From the planning workbook', expected_by: '2026-12-15' })
    const { apps } = await agent.ok<Listed>('list_datasets')
    expect(apps.map(({ app }) => app)).toEqual(['storesales'])
    expect(apps[0].datasets[1]).toMatchObject({ name: 'targets', served_from: 'Stand-in', note: 'From the planning workbook', expected_by: '2026-12-15' })
    expect((await agent.ok<Listed>('list_datasets', { app: 'nosuchapp' })).apps).toEqual([])
    await warehouseTargets(WAREHOUSE_TARGETS)
    expect(await agent.ok<Switched>('switch_to_warehouse', { app: 'storesales', dataset: 'targets' }))
      .toMatchObject({ switched: true, message: 'targets now reads the warehouse: 2 rows.' })
  })

  test('an agent of someone who is not a System Manager is refused by the same rule', async ({ admin, createUser }) => {
    const { reader } = await storeSales(admin, createUser)
    const agent = await connectAgent(await issueToken(reader))
    for (const [tool, args] of [['list_datasets', {}], ['check_stand_in', file], ['switch_to_warehouse', { app: 'storesales', dataset: 'targets' }]] as const) {
      const refused = await agent.call(tool, args)
      expect(refused.isError, tool).toBe(true)
      expect(refused.content[0].text, tool).toMatch(/PermissionError/)
    }
  })
})
