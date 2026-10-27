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
import { drainJobs, loadJobs } from '../src/jobs'
import { datasetsDue } from '../src/jobs/refresh-datasets'
import { shapeRows, type DatasetDeclaration } from '../src/app-datasets'
import { inAppTransaction, sql } from '../src/db'
import { assertStillServing, servingIdentity } from '../src/app-lifecycle'

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
  // Adjacent ids above 2^53 (where a JavaScript number cannot tell them
  // apart), booked at times of day that a date column holds as days.
  await warehouse.unsafe(`create table b4_dataset.accounts (account_id bigint, booked_at timestamp, amount numeric(12,2));
    insert into b4_dataset.accounts values (9007199254740992, '2026-10-01 12:00:00', 1.00), (9007199254740993, '2026-10-02 23:30:00', 2.00)`)
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

/** A handler's outside call that the test lets finish: `inside` settles once
 *  the handler is waiting, `release` lets it go on. */
function stall() {
  let entered!: () => void
  let release!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  return { inside, gate, entered, release }
}
/** Settles with `work`, or fails if it is still blocked after a few seconds. */
const within = <T>(work: Promise<T>, ms = 3000) => Promise.race([work,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('blocked: still waiting')), ms))])

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

  // A MotherDuck connection cannot be opened read-only; only a read-scaling
  // token keeps it so, and the platform cannot see which token it holds. The
  // address below is never dialled: the refusal comes first.
  test('a MotherDuck source not marked as holding a read-scaling token cannot back a dataset', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser, { source: false })
    await admin.post('/api/table/Data%20Source', { row_id: 'datasetproof-warehouse', engine: 'duckdb', url_env: 'B4_MOTHERDUCK_URL', access: 'read_only' })
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withNamedVariable('B4_MOTHERDUCK_URL', 'md:never_dialled', async () => {
      await expectApiError(reader.post(read + 'inside', { payload: {} }), { status: 409, type: 'NotSetUpError' })
      expect((await appSetupState()).find(({ app }) => app === 'datasetproof')?.missing)
        .toEqual(['read-only data source datasetproof-warehouse', 'data source datasetproof-missing'])
    })
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

describe('exact keys and days', () => {
  const ACCOUNTS = { '9007199254740992': { account_id: '9007199254740992', booked_at: '2026-10-01', amount: 1 },
    '9007199254740993': { account_id: '9007199254740993', booked_at: '2026-10-02', amount: 2 } }

  // A key or mapped integer column keeps its exact digits, so two ids that a
  // JavaScript number would round together never cross into each other's scope.
  test.for(Object.keys(ACCOUNTS))('a reader of account %s sees only that account, cached and live', async (id, { admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    const roster = await fixtureModule('placeroster', provider)
    roster.faults.result = [{ label: 'One account', filters: { account: [id] } }]
    await buildSnapshot('datasetproof.accounts')
    app.hooks.run = async (context: Context) => ({ cached: await context.datasets.active('accounts'), live: await context.datasets.live('accounts') })
    const { result } = await reader.post<{ result: Record<'cached' | 'live', { rows: unknown[] }> }>(read + 'outside', { payload: {} })
    delete roster.faults.result
    const only = [ACCOUNTS[id as keyof typeof ACCOUNTS]]
    expect({ cached: result.cached.rows, live: result.live.rows }).toEqual({ cached: only, live: only })
  })

  test('a date key fed by a time of day gives the same rows cached and live', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    const roster = await fixtureModule('placeroster', provider)
    roster.faults.result = [{ label: 'Both accounts', filters: { account: Object.keys(ACCOUNTS) } }]
    await buildSnapshot('datasetproof.accounts')
    app.hooks.run = async (context: Context) => ({ cached: await context.datasets.active('accounts', { booked_at: '2026-10-01' }),
      live: await context.datasets.live('accounts', { booked_at: '2026-10-01' }) })
    const { result } = await reader.post<{ result: Record<'cached' | 'live', { rows: unknown[] }> }>(read + 'outside', { payload: {} })
    delete roster.faults.result
    const only = [ACCOUNTS['9007199254740992']]
    expect({ cached: result.cached.rows, live: result.live.rows }).toEqual({ cached: only, live: only })
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

  test('while its handler waits on an outside call, a save and an app lifecycle change both complete', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    const call = stall()
    app.hooks.run = async () => { call.entered(); await call.gate; return 'answered' }
    const pending = reader.post(read + 'outside', { payload: {} })
    try {
      await call.inside
      await within(position(admin, 'someone', 'South', 'S1', 'mens'))
      await within(admin.post('/api/set_app_enabled', { name: 'placeroster', enabled: true }))
    } finally { call.release() }
    expect(await pending).toEqual({ result: 'answered' })
  })

  // The lifecycle lock's pool holds ten connections.
  test('ten outbound handlers waiting at once do not hold up an ordinary read', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    const calls = Array.from({ length: 10 }, stall)
    let next = 0
    app.hooks.run = async () => { const call = calls[next++]; call.entered(); await call.gate; return 'answered' }
    const pending: Promise<unknown>[] = []
    try {
      for (const call of calls) {
        pending.push(reader.post(read + 'outside', { payload: {} }))
        await within(call.inside)
      }
      await within(admin.get('/api/table/placeroster.position'))
    } finally { for (const call of calls) call.release() }
    for (const answer of pending) expect(await answer).toEqual({ result: 'answered' })
  })

  test.for([
    ['its answer', async () => 'answered'],
    ['its view record', async (context: Context) => { await context.recordView({ dataset: 'sales' }); return 'answered' }],
  ] as const)('an app disabled while the handler waited has %s refused', async ([, finish], { admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    const call = stall()
    app.hooks.run = async (context: Context) => { call.entered(); await call.gate; return finish(context) }
    const pending = reader.post(read + 'outside', { payload: {} })
    try {
      await call.inside
      await within(admin.post('/api/set_app_enabled', { name: 'datasetproof', enabled: false }))
    } finally { call.release() }
    await expect(pending).rejects.toMatchObject({ status: 403 })
    expect(await sql`select 1 from access_log where "user" = ${reader.user} and operation = 'view_report'`).toHaveLength(0)
  })

  test('an app now serving another version than the one a handler ran under has its answer refused', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const ran = await servingIdentity('datasetproof')
    await sql`update installed_app set artifact_digest = 'another-artifact' where name = 'datasetproof'`
    await expect(assertStillServing('datasetproof', ran)).rejects.toMatchObject({ type: 'ConflictError' })
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

describe('an outbound declaration', () => {
  // An action writes inside its transaction; only a read may run after it.
  test('is refused on an action', async () => {
    const copy = await mkdtemp(resolve('test/.dataset-proof-'))
    try {
      await cp(fixture, copy, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
      manifest.actions = { version: 2, tables: ['datasetproof.note'], operations: { inside: manifest.reads.operations.outside } }
      await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(manifest))
      const failures = await discoverPackages([copy])
      expect(failures).toHaveLength(1)
      expect(failures[0].error).toMatch(/actions/)
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  })
})

describe('the shaping function', () => {
  const dataset = (columns: DatasetDeclaration['columns']): DatasetDeclaration =>
    ({ name: 'probe', source: 's', query: 'select 1', columns, keys: [], filters: { store: columns[0].name } })

  // A count or amount is answered as a number, so it must be one a number holds exactly.
  test('refuses an integer value column holding a number above 2^53', () => {
    expect(() => shapeRows(dataset([{ name: 'store', type: 'text' }, { name: 'units', type: 'integer' }]),
      [{ store: 'N1', units: '9007199254740993' }])).toThrow(/units holds a value that is not integer/)
  })

  test('holds each value to its declared type', () => {
    const shaped = shapeRows(dataset([
      { name: 'flag', type: 'boolean' }, { name: 'said', type: 'boolean' }, { name: 'ratio', type: 'number' },
      { name: 'day', type: 'date' }, { name: 'gap', type: 'text' },
    ]), [{ flag: true, said: 'false', ratio: '0.25', day: new Date('2026-10-05T00:00:00Z'), gap: null }])
    expect(shaped).toEqual([{ flag: true, said: false, ratio: 0.25, day: '2026-10-05', gap: null }])
  })

  test.for([
    ['an integer column holding a fraction', { name: 'units', type: 'integer' }, { units: '1.5' }, /units holds a value that is not integer/],
    ['a boolean column holding text', { name: 'flag', type: 'boolean' }, { flag: 'yes' }, /flag holds a value that is not boolean/],
    ['a date column holding text', { name: 'day', type: 'date' }, { day: 'soon' }, /day holds a value that is not date/],
    ['a query that did not return the column', { name: 'units', type: 'integer' }, {}, /did not return column units/],
  ] as const)('refuses %s', ([, column, raw, message]) => {
    expect(() => shapeRows(dataset([column]), [raw])).toThrow(message)
  })
})

describe('what a read may ask of a dataset', () => {
  test.for([
    ['a dataset the app has not declared', (c: Context) => c.datasets.active('elsewhere'), /has not declared the dataset elsewhere/],
    ['filters that are not an object', (c: Context) => c.datasets.active('sales', ['N1'] as never), /filters must be an object/],
    ['an empty list of filter values', (c: Context) => c.datasets.active('sales', { plant_code: [] }), /must be a value or a list of values/],
    ['a view of a dataset the app has not declared', (c: Context) => c.recordView({ dataset: 'elsewhere' }), /recordView takes \{ dataset \}/],
  ] as const)('refuses %s', async ([, ask, message], { admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = ask
    await expectApiError(reader.post(read + 'inside', { payload: {} }), { status: 417, message: expect.stringMatching(message) })
  })

  test('a view recorded without a dataset names the read', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = async (context: Context) => { await context.recordView(); return null }
    await reader.post(read + 'inside', { payload: {} })
    const rows = await sql`select ref_table, method from access_log where "user" = ${reader.user} and operation = 'view_report'`
    expect(rows.map(r => ({ ...r }))).toEqual([{ ref_table: 'datasetproof.inside', method: null }])
  })
})

describe('the refresh job', () => {
  test('builds an app dataset a reader asked for before it had built', async ({ admin, createUser }) => {
    await loadJobs()
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await reader.post(read + 'inside', { payload: {} })
    expect(await datasetsDue()).toContain('datasetproof.sales')
    // The sandbox's now() is the test's start; the queued job's run_at is the clock's.
    await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
    await drainJobs()
    expect(await activeSnapshot('datasetproof.sales')).toMatchObject({ row_count: 4 })
  })
})
