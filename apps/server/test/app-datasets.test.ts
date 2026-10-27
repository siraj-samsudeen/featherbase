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
import { activeSnapshot, buildSnapshot } from '../src/dataset-snapshot'
import { withNamedVariable } from '../src/env'

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
