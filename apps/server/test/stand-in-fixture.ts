// #1409: what the stand-in dataset tests share. The app is the fixture
// test-apps/fixtures/stand-in-proof (Store Sales: `sales` and `targets`). Its
// "warehouse" is a schema of made-up rows in the sibling test database
// (external-database.ts), reached through an ordinary postgres Data Source.
import { resolve } from 'node:path'
import postgres from 'postgres'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { afterAll, beforeAll, beforeEach, expect } from 'vitest'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { discoverPackages } from '../src/runtime-packages'
import { invalidateSources } from '../src/sources/registry'
import type { DatasetAnswer } from '../src/app-datasets'

export const FIXTURE = resolve('../..', 'test-apps/fixtures/stand-in-proof')
export const READ = '/api/app_reads/storesales/'
export const TARGETS = '/api/datasets/storesales/targets/'
const SOURCE_ENV = 'STAND_IN_PROOF_WAREHOUSE_URL'
process.env[SOURCE_ENV] = EXTERNAL_DATABASE_URL

/** The client, naming the app version a page would have loaded. */
export const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'storesales@1.0.0', ...init?.headers },
}) }, client.token, client.user)

/** A planning workbook's targets, saved as CSV: three stores, 10,00,000.50 in all. */
export const TARGETS_CSV = [
  'store,month,target,units,confirmed',
  'N1,2026-11-01,500000.50,1200,true',
  'S1,2026-11-01,300000,800,false',
  'E1,2026-11-01,200000,500,TRUE',
  '',
].join('\n')
/** The same rows as a read answers them, in the dataset's order. */
export const TARGET_ROWS = [
  { store: 'E1', month: '2026-11-01', target: 200000, units: 500, confirmed: true },
  { store: 'N1', month: '2026-11-01', target: 500000.5, units: 1200, confirmed: true },
  { store: 'S1', month: '2026-11-01', target: 300000, units: 800, confirmed: false },
]
/** What the warehouse holds once it has targets: a tenth of the stand-in's total. */
export const WAREHOUSE_TARGETS = [['N1', '2026-11-01', '60000', 150, true], ['S1', '2026-11-01', '40000', 90, true]] as const
export const WAREHOUSE_TARGET_ROWS = [
  { store: 'N1', month: '2026-11-01', target: 60000, units: 150, confirmed: true },
  { store: 'S1', month: '2026-11-01', target: 40000, units: 90, confirmed: true },
]
const SALES = [['N1', '2026-11-26', '18250.75', 41], ['S1', '2026-11-26', '9120', 23]] as const
export const SALES_ROWS = [
  { store: 'N1', business_day: '2026-11-26', amount: 18250.75, units: 41 },
  { store: 'S1', business_day: '2026-11-26', amount: 9120, units: 23 },
]

let warehouse: ReturnType<typeof postgres>
/** Replace the warehouse's targets (none, until it "has" them). */
export async function warehouseTargets(rows: readonly (readonly unknown[])[] = []) {
  await warehouse.unsafe('truncate standin_proof.targets')
  for (const row of rows) await warehouse.unsafe('insert into standin_proof.targets values ($1, $2, $3, $4, $5)', row as never[])
}

/** The warehouse plays a store outside the platform, so it is committed
 *  outside the sandbox: made before a file's tests, dropped after them. */
export function useWarehouse() {
  beforeAll(async () => {
    warehouse = postgres(EXTERNAL_DATABASE_URL, { max: 2, onnotice: () => {} })
    await warehouse.unsafe('drop schema if exists standin_proof cascade')
    await warehouse.unsafe(`create schema standin_proof;
      create table standin_proof.sales (store text, business_day date, amount numeric, units integer);
      create table standin_proof.targets (store text, month date, target numeric, units integer, confirmed boolean)`)
    for (const row of SALES) await warehouse.unsafe('insert into standin_proof.sales values ($1, $2, $3, $4)', row as never[])
  })
  beforeEach(() => warehouseTargets())
  afterAll(async () => {
    invalidateSources()
    await warehouse.unsafe('drop schema if exists standin_proof cascade')
    await warehouse.end({ timeout: 2 })
  })
}

/** Store Sales installed, with a reader. `source: false` leaves out the Data
 *  Source its datasets name, as on an instance whose warehouse is not connected. */
export async function storeSales(admin: TestClient, createUser: CreateUserFn, { source = true } = {}) {
  expect(await discoverPackages([FIXTURE])).toEqual([])
  await admin.post('/api/install_app', { name: 'storesales' })
  invalidateSources()
  if (source) await admin.post('/api/table/Data%20Source', {
    row_id: 'storesales-warehouse', engine: 'postgres', url_env: SOURCE_ENV, access: 'read_only' })
  return { reader: await createUser({ email: 'reader@example.test', roles: ['Store Sales Reader'] }) }
}

type Loaded = { app: string; dataset: string; rows: number; loaded_at: string }
/** Load the planning workbook's targets as the stand-in. */
export const loadTargets = (admin: TestClient, more: Record<string, unknown> = {}) =>
  admin.post<Loaded>(`${TARGETS}load_stand_in`, { csv: TARGETS_CSV, ...more })

/** The app's read of one dataset, as its page would ask for it. */
export const ask = async (client: TestClient, dataset: string, more: Record<string, unknown> = {}, read = 'ask') =>
  (await client.post<{ result: DatasetAnswer | null }>(READ + read, { payload: { dataset, ...more } })).result
