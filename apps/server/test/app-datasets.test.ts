// #625 (design E3, E5): an app declares a cached dataset (a Data Source the
// instance already has, the query, typed columns, keys and the scope filter
// mapping). The platform builds the snapshot on the dataset engine and reads
// it only through a scope-checked read; a live read runs the same query,
// limited to the reader's scope, through the same shaping. A read declared
// outbound runs after its authorization transaction has closed.
//
// Fixtures: runtime-apps/fixtures/dataset-proof reads the dataset;
// runtime-apps/fixtures/place-roster provides people's places. The "warehouse"
// is a schema of made-up rows in the sibling test database (external-database.ts),
// reached through an ordinary postgres Data Source. Nothing remote is touched.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import { test as pgTest } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { invalidateSources } from '../src/sources/registry'
import { activeSnapshot, buildSnapshot, pendingMisses } from '../src/dataset-snapshot'
import { expectApiError } from './fixtures'
import type { RuntimeReadContext } from 'shared'
import { withNamedVariable } from '../src/env'
import { appSetupState } from '../src/app-settings'
import { inAppTransaction, sql } from '../src/db'

const fixture = resolve('../..', 'runtime-apps/fixtures/dataset-proof')
const provider = resolve('../..', 'runtime-apps/fixtures/place-roster')
const read = '/api/app_reads/datasetproof/'
const SOURCE_ENV = 'B4_WAREHOUSE_URL'
process.env[SOURCE_ENV] = EXTERNAL_DATABASE_URL

const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'datasetproof@1.0.0', ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

// The warehouse plays a store outside the platform, so it is committed
// outside the sandbox and dropped at the end.
let warehouse: ReturnType<typeof postgres>
const SALES = [
  ['N1', 'kids', '2026-10-01', '100.50', 3, 'north kids'],
  ['N1', 'kids', '2026-10-02', '20.25', 1, 'north kids'],
  ['N1', 'mens', '2026-10-01', '300.00', 5, 'north mens'],
  ['S1', 'kids', '2026-10-01', '40.00', 2, 'south kids'],
] as const
async function fillWarehouse(rows: readonly (readonly unknown[])[] = SALES) {
  await warehouse.unsafe('truncate b4_dataset.sales')
  for (const row of rows) await warehouse.unsafe('insert into b4_dataset.sales values ($1, $2, $3, $4, $5, $6)', row as never[])
}
beforeAll(async () => {
  warehouse = postgres(EXTERNAL_DATABASE_URL, { max: 2, onnotice: () => {} })
  await warehouse.unsafe('drop schema if exists b4_dataset cascade')
  await warehouse.unsafe('create schema b4_dataset')
  await warehouse.unsafe(`create table b4_dataset.sales (plant_code text, section_code text, business_day date,
    amount numeric(12,2), units integer, note text)`)
})
beforeEach(() => fillWarehouse())
afterAll(async () => {
  invalidateSources()
  await warehouse.unsafe('drop schema if exists b4_dataset cascade')
  await warehouse.end({ timeout: 2 })
})

async function fixtureModule(name: string, directory: string) {
  const digest = availableRuntimeVersions().find(p => p.name === name)!.digest
  return import(`${pathToFileURL(resolve(directory, 'server.mjs')).href}?artifact=${digest}`)
}

async function setup(admin: TestClient, createUser: CreateUserFn, { roles = ['Dataset Reader'], source = true } = {}) {
  expect(await discoverPackages([fixture, provider])).toEqual([])
  await admin.post('/api/install_app', { name: 'datasetproof' })
  await admin.post('/api/install_app', { name: 'placeroster' })
  invalidateSources()
  if (source) await admin.post('/api/table/Data%20Source', {
    row_id: 'datasetproof-warehouse', engine: 'postgres', url_env: SOURCE_ENV, access: 'read_only' })
  const reader = await createUser({ email: 'reader@example.test', roles })
  const app = await fixtureModule('datasetproof', fixture)
  app.calls.handler = 0
  return { reader, app }
}

describe('the snapshot of an app dataset', () => {
  test('a refresh builds and activates it from the declared query', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const built = await buildSnapshot('datasetproof.sales')
    expect(built).toMatchObject({ status: 'activated', rowCount: 4 })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(built.snapshotId)
  })

  test('a refresh that fails keeps the last good copy active', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const good = await buildSnapshot('datasetproof.sales')
    await withNamedVariable(SOURCE_ENV, undefined, async () => {
      invalidateSources()
      expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'failed' })
    })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  test('an empty candidate is refused, so the last good copy keeps serving', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse([])
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'refused' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  // The rows hold every place's figures; the scope-checked read is the only way out.
  test('is not a Table, so no generic read or export reaches its rows', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    for (const name of ['app_dataset_row', 'App Dataset Row', 'datasetproof.sales'])
      expect((await admin.fetch(`/api/table/${encodeURIComponent(name)}`)).status).toBe(404)
    const exported = await admin.fetch('/api/instance-settings/export')
    expect(exported.status).toBe(200)
    expect(await exported.text()).not.toContain('north kids')
  })
})

async function position(admin: TestClient, person: string, place: string, store: string, section: string) {
  await admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${place}-${section}`, person, place, store, section } })
}

type Context = RuntimeReadContext

const row = (plant_code: string, section_code: string, business_day: string, amount: number, units: number, note: string) =>
  ({ plant_code, section_code, business_day, amount, units, note })

describe('a cached dataset read', () => {
  test('returns only the rows the caller\'s places cover', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const answer = await reader.post<{ result: { served: string; rows: unknown[] } }>(read + 'inside', { payload: {} })
    expect(answer.result).toMatchObject({ dataset: 'sales', served: 'cached', rows: [
      row('N1', 'kids', '2026-10-01', 100.5, 3, 'north kids'),
      row('N1', 'kids', '2026-10-02', 20.25, 1, 'north kids'),
    ] })
  })

  test('a place naming a filter the dataset does not map contributes no rows', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    const roster = await fixtureModule('placeroster', provider)
    roster.faults.result = [{ label: 'North floor 1', filters: { store: ['N1'], floor: ['1'] } }, { label: 'South', filters: { store: ['S1'] } }]
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const answer = await reader.post<{ result: { rows: unknown[] } }>(read + 'inside', { payload: {} })
    delete roster.faults.result
    expect(answer.result.rows).toEqual([row('S1', 'kids', '2026-10-01', 40, 2, 'south kids')])
  })

  test('a filter on a declared key narrows the rows', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales', { business_day: ['2026-10-02'] })
    const answer = await reader.post<{ result: { rows: unknown[] } }>(read + 'inside', { payload: {} })
    expect(answer.result.rows).toEqual([row('N1', 'kids', '2026-10-02', 20.25, 1, 'north kids')])
  })

  test('a filter on a column that is not a declared key is refused', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales', { note: 'north kids' })
    await expectApiError(reader.post(read + 'inside', { payload: {} }), { status: 417, message: expect.stringMatching(/cannot be filtered on note/) })
  })

  test('a read whose policy carries no places gets no rows', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const answer = await reader.post<{ result: { rows: unknown[] } }>(read + 'unscoped', { payload: {} })
    expect(answer.result.rows).toEqual([])
  })

  test('before the dataset has built, answers nothing and records the ask', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    expect(await reader.post(read + 'inside', { payload: {} })).toEqual({ result: null })
    expect(await pendingMisses()).toContain('datasetproof.sales')
  })

  test('the release check and Instance health name a dataset\'s missing data source', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const state = (await appSetupState()).find(({ app }) => app === 'datasetproof')
    expect(state?.missing).toEqual(['data source datasetproof-missing'])
  })

  test('a dataset whose data source the instance does not have answers "not set up yet"', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.active('unplugged')
    await expectApiError(reader.post(read + 'inside', { payload: {} }), { status: 409, type: 'NotSetUpError' })
  })
})

describe('a live dataset read', () => {
  test('answers the same rows, in the same shape and with the same totals, as the cached read', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North', 'N1', 'kids')
    await position(admin, reader.user!, 'North', 'N1', 'mens')
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = async (context: Context) => ({ cached: await context.datasets.active('sales'), live: await context.datasets.live('sales') })
    const { result } = await reader.post<{ result: Record<'cached' | 'live', { served: string; rows: { amount: number }[] }> }>(read + 'outside', { payload: {} })
    const total = (rows: { amount: number }[]) => rows.reduce((sum, r) => sum + r.amount, 0)
    expect([result.cached.served, result.live.served]).toEqual(['cached', 'live'])
    expect(Object.keys(result.live).sort()).toEqual(Object.keys(result.cached).sort())
    expect(result.live.rows).toEqual(result.cached.rows)
    expect(result.cached.rows).toHaveLength(3)
    expect(total(result.live.rows)).toBe(total(result.cached.rows))
  })

  test('is refused in a read that is not declared outbound', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.live('sales')
    await expectApiError(reader.post(read + 'inside', { payload: {} }), { status: 417, message: expect.stringMatching(/declare the read outbound/) })
  })
})

describe('an outbound read', () => {
  // The handler's `sql` would use the transaction bound to its async context;
  // an outbound handler has none, so it holds no transaction and no row lock.
  test.for([['inside', true], ['outside', false]] as const)('the %s read runs its handler inside a transaction: %s', async ([operation, open], { admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = async () => ({ open: inAppTransaction() })
    expect(await reader.post(read + operation, { payload: {} })).toEqual({ result: { open } })
  })

  test('a handler that reads documents after the transaction closed fails loudly', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.documents.list('datasetproof.note')
    await expectApiError(reader.post(read + 'outside', { payload: {} }), { status: 417, message: expect.stringMatching(/transaction has closed/) })
  })

  test('recordView writes one Access Log row for the viewing person, saying what was served', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    const built = await buildSnapshot('datasetproof.sales')
    app.hooks.run = async (context: Context) => {
      await context.datasets.active('sales')
      await context.recordView({ dataset: 'sales' })
      return null
    }
    await reader.post(read + 'outside', { payload: {} })
    const rows = await sql`select ref_table, reference_name, method, scope from access_log where "user" = ${reader.user} and operation = 'view_report'`
    expect(rows.map(r => ({ ...r }))).toEqual([{ ref_table: 'datasetproof.sales', reference_name: built.snapshotId, method: 'cached', scope: 'North / Kids' }])
  })
})

describe('a dataset declaration', () => {
  test('is accepted at discovery', async () => {
    expect(await discoverPackages([fixture, provider])).toEqual([])
  })

  test.for([
    ['key is not one of its columns', { keys: ['plant_code', 'region'] }, /key region is not one of its columns/],
    ['scope filter maps to a money column', { filters: { store: 'amount' } }, /scope filter amount must be text, integer or date/],
    ['query holds a second statement', { query: 'select 1; drop table b4_dataset.sales' }, /one statement/],
  ] as const)('refuses an app whose dataset %s', async ([, change, message]) => {
    const copy = await mkdtemp(resolve('test/.dataset-proof-'))
    try {
      await cp(fixture, copy, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
      manifest.datasets[0] = { ...manifest.datasets[0], ...change }
      await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(manifest))
      const failures = await discoverPackages([copy])
      expect(failures).toHaveLength(1)
      expect(failures[0].error).toMatch(message)
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  })
})
