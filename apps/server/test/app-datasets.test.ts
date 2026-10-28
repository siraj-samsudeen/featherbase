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
import { activeSnapshot, buildSnapshot, pendingMisses, recordMiss } from '../src/dataset-snapshot'
import { expectApiError } from './fixtures'
import type { RuntimeReadContext } from 'shared'
import { withNamedVariable } from '../src/env'
import { appSetupState } from '../src/app-settings'
import { drainJobs, enqueue, loadJobs } from '../src/jobs'
import { datasetsDue } from '../src/jobs/refresh-datasets'
import { guardRefusal, recordPlaceDrops, shapeRows, storedRowJson, type DatasetDeclaration, type DatasetGuard, type PlaceDrop } from '../src/app-datasets'
import { _getRootSql, inAppTransaction, sql } from '../src/db'
import { assertStillServing, servingIdentity } from '../src/app-lifecycle'
import { runHealthChecks } from '../src/instance-health'

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
  // `amount` is unbounded numeric so a test can hold more digits than a
  // JavaScript number does (#676).
  await warehouse.unsafe(`create table b4_dataset.sales (plant_code text, section_code text, business_day date,
    amount numeric, units integer, note text)`)
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

// #669: the fixture with a guard on its sales dataset, discovered from a copy.
const guardedCopies: string[] = []
afterAll(() => Promise.all(guardedCopies.map(copy => rm(copy, { recursive: true, force: true }))))
async function setupGuarded(admin: TestClient, guard: DatasetGuard[]) {
  const copy = await mkdtemp(resolve('test/.dataset-proof-'))
  guardedCopies.push(copy)
  await cp(fixture, copy, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
  manifest.datasets[0].guard = guard
  await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(manifest))
  expect(await discoverPackages([copy, provider])).toEqual([])
  await admin.post('/api/install_app', { name: 'datasetproof' })
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'datasetproof-warehouse', engine: 'postgres', url_env: SOURCE_ENV, access: 'read_only' })
  return copy
}
/** SALES with `units` set per row, in order. */
const withUnits = (...units: (number | null)[]) => SALES.map((r, i) => [...r.slice(0, 4), units[i], r[5]])

/** Upgrade the installed datasetproof to 1.1.0, whose sales dataset is the
 *  installed one with `change` applied. */
async function upgradeSales(admin: TestClient, installed: string, change: Record<string, unknown>) {
  const upgraded = await mkdtemp(resolve('test/.dataset-proof-'))
  guardedCopies.push(upgraded)
  await cp(installed, upgraded, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(upgraded, 'featherbase.json'), 'utf8'))
  manifest.datasets[0] = { ...manifest.datasets[0], ...change }
  manifest.migrations = [{ id: 'sales_guard', fromVersion: '1.0.0', toVersion: '1.1.0', operations: [] }]
  await writeFile(resolve(upgraded, 'featherbase.json'), JSON.stringify(manifest))
  await writeFile(resolve(upgraded, 'package.json'), JSON.stringify({ name: 'featherbase-dataset-proof', version: '1.1.0', type: 'module' }))
  expect(await discoverPackages([installed, upgraded, provider])).toEqual([])
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'datasetproof', version: '1.1.0' })
  await admin.post('/api/upgrade_app', { name: 'datasetproof', version: '1.1.0', planId: plan.planId })
  await admin.post('/api/activate_app_upgrade', { name: 'datasetproof', version: '1.1.0' })
}

describe('the guard on an app dataset', () => {
  const dropGuard: DatasetGuard[] = [{ kind: 'max_drop_pct', column: 'units', value: 50 }]

  test('a refresh that fails it keeps the last good copy active', async ({ admin }) => {
    await setupGuarded(admin, dropGuard)
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withUnits(3, 0, 0, null))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: units values dropped 75% (4 → 1), limit 50%' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  test('a refresh that passes it activates', async ({ admin }) => {
    await setupGuarded(admin, dropGuard)
    await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withUnits(3, 0, 5, null))
    const next = await buildSnapshot('datasetproof.sales')
    expect(next).toMatchObject({ status: 'activated' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(next.snapshotId)
  })

  test('counts empty and zero values alike as missing', async ({ admin }) => {
    await setupGuarded(admin, [{ kind: 'not_all_zero', column: 'units' }])
    await fillWarehouse(withUnits(0, null, 0, null))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: every units value is empty or zero (4 rows)' })
  })

  test('a refusal is a failed refresh run that names the guard and its numbers', async ({ admin }) => {
    await loadJobs()
    await setupGuarded(admin, dropGuard)
    await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withUnits(3, 0, 0, null))
    await enqueue('refresh_datasets')
    await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
    await drainJobs()
    const [run] = await sql`select outcome, error from job_execution where method = 'refresh_datasets'`
    expect(run.outcome).toBe('error')
    expect(run.error).toContain('datasetproof.sales: refused — sales: units values dropped 75% (4 → 1), limit 50%')
  })

  // A guard decides which refresh may replace the copy, not what the copy
  // holds: an upgrade that adds or tunes one keeps the copy it guards.
  test('an upgrade that adds one keeps the last good copy, and guards it', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const good = await buildSnapshot('datasetproof.sales')
    await upgradeSales(admin, fixture, { guard: dropGuard })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
    await fillWarehouse(withUnits(3, 0, 0, null))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'refused' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  test('an upgrade that tunes one compares against the same copy', async ({ admin }) => {
    const installed = await setupGuarded(admin, dropGuard)
    const good = await buildSnapshot('datasetproof.sales')
    await upgradeSales(admin, installed, { guard: [{ kind: 'max_drop_pct', column: 'units', value: 30 }] })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
    // 50% passes the old limit and fails the new one.
    await fillWarehouse(withUnits(3, 0, 5, null))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: units values dropped 50% (4 → 2), limit 30%' })
  })

  test('an upgrade that changes the query still retires the copy', async ({ admin }) => {
    const installed = await setupGuarded(admin, dropGuard)
    await buildSnapshot('datasetproof.sales')
    await upgradeSales(admin, installed, { query: 'select plant_code, section_code, business_day, amount, units, note from b4_dataset.sales where units > 0' })
    expect(await activeSnapshot('datasetproof.sales')).toBeNull()
  })

  // Without a guard only an empty refresh is refused, as before #669.
  test('a dataset without one activates a refresh that drops most of its values', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withUnits(3, 0, 0, null))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'activated' })
  })
})

/** SALES with `amount`, `units` and `note` set per row, in order. */
const withFigures = (...figures: (readonly [string | null, number | null, string | null])[]) =>
  SALES.map((r, i) => [...r.slice(0, 3), ...figures[i]])
const month = (note: string | null, ...amounts: (string | null)[]) => amounts.map(amount => [amount, 1, note] as const)

// #676: a total is summed from the stored rows in SQL numeric, so money
// compares to the paisa: 0.10 + 0.20 is 0.30, where floats make it more.
describe('the sum guard on an app dataset', () => {
  const sumGuard: DatasetGuard[] = [{ kind: 'max_sum_drop_pct', column: 'amount', value: 50 }]

  test('a refresh whose total drops exactly its limit activates', async ({ admin }) => {
    await setupGuarded(admin, sumGuard)
    await fillWarehouse(withFigures(...month('2026-10', '0.10', '0.20', '0', null)))
    await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month('2026-10', '0.15', '0', '0', null)))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'activated' })
  })

  test('a refresh whose total drops just over its limit keeps the last good copy', async ({ admin }) => {
    await setupGuarded(admin, sumGuard)
    await fillWarehouse(withFigures(...month('2026-10', '0.10', '0.20', '0', null)))
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month('2026-10', '0.14', '0', '0', null)))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: amount total dropped 53.3% (0.3 → 0.14), limit 50%' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })
})

// #676 (Codex round 1): a money value with more digits than a JavaScript
// number holds is stored exactly, so a drop that Number() would round away
// still counts.
describe('the sum guard on high-precision values', () => {
  test.for([
    ['a whole number above 2^53', '9007199254740993', '9007199254740992',
      'sales: amount total dropped more than 0% (9,00,71,99,25,47,40,993 → 9,00,71,99,25,47,40,992), limit 0%'],
    ['a fraction finer than a double', '1.00000000000000001', '1', 'sales: amount total dropped more than 0% (1.00000000000000001 → 1), limit 0%'],
  ] as const)('refuses a one-unit drop in %s at a limit of 0', async ([, before, now, reason], { admin }) => {
    await setupGuarded(admin, [{ kind: 'max_sum_drop_pct', column: 'amount', value: 0 }])
    await fillWarehouse(withFigures(...month('2026-10', before, '0', '0', '0')))
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month('2026-10', now, '0', '0', '0')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'refused', reason })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })
})

// #676: `within` keeps a drop comparison inside one period, read from the
// stored rows of the candidate and the active snapshot.
describe('a drop guard within a period', () => {
  const guards: DatasetGuard[] = [
    { kind: 'max_drop_pct', column: 'amount', value: 50, within: 'note' },
    { kind: 'max_sum_drop_pct', column: 'amount', value: 50, within: 'note' },
  ]

  test('activates the first refresh of a new period, however small', async ({ admin }) => {
    await setupGuarded(admin, guards)
    await fillWarehouse(withFigures(...month('2026-10', '100', '200', '300', '400')))
    await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month('2026-11', '5', '0', '0', '0')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'activated' })
  })

  test.for([
    ['a count', [guards[0]], month('2026-10', '400', '0', '0', '0'), 'sales: amount values dropped 75% (4 → 1), limit 50%'],
    ['a total', [guards[1]], month('2026-10', '100', '100', '100', '100'), 'sales: amount total dropped 60% (1,000 → 400), limit 50%'],
  ] as const)('refuses %s dropping over its limit in the same period', async ([, guard, figures, reason], { admin }) => {
    await setupGuarded(admin, [...guard])
    await fillWarehouse(withFigures(...month('2026-10', '100', '200', '300', '400')))
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...figures))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'refused', reason })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  test.for([
    ['two periods', [...month('2026-10', '1', '1'), ...month('2026-11', '1', '1')], 'sales: note holds 2 values and 0 empty, but amount is compared within one note'],
    ['an empty period', [...month('2026-10', '1', '1', '1'), ...month(null, '1')], 'sales: note holds 1 value and 1 empty, but amount is compared within one note'],
  ] as const)('refuses a candidate holding %s', async ([, figures, reason], { admin }) => {
    await setupGuarded(admin, [guards[1]])
    await fillWarehouse(withFigures(...figures))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'refused', reason })
  })

  // Codex round 1: a blank period is a missing one, not a new one, so a
  // collapsed refresh cannot skip the comparison by blanking its month.
  test.for([
    ['an empty-text period', ''], ['a blank period', '   '],
    // Codex round 2: blank is any whitespace a JavaScript trim removes, not only spaces.
    ['a tab', '\t'], ['a line feed', '\n'], ['a carriage return and line feed', '\r\n'],
    ['mixed whitespace', ' \t\n'], ['a no-break space', ' '],
  ] as const)('refuses a candidate holding %s on every row', async ([, blank], { admin }) => {
    await setupGuarded(admin, [guards[1]])
    await fillWarehouse(withFigures(...month('2026-10', '100', '200', '300', '400')))
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month(blank, '1', '0', '0', '0')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: note holds 0 values and 4 empty, but amount is compared within one note' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  // A padded period (a source's char(n) column, say) is the period it pads,
  // so padding cannot pass a collapsed refresh off as a new period.
  test('compares a padded period as the period it pads', async ({ admin }) => {
    await setupGuarded(admin, [guards[1]])
    await fillWarehouse(withFigures(...month('2026-10', '100', '200', '300', '400')))
    const good = await buildSnapshot('datasetproof.sales')
    await fillWarehouse(withFigures(...month(' 2026-10\t', '1', '0', '0', '0')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: amount total dropped 99.9% (1,000 → 1), limit 50%' })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
  })

  test('compares nothing against an active snapshot of more than one period', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await fillWarehouse(withFigures(...month('2026-10', '100', '100'), ...month('2026-11', '100', '100')))
    await buildSnapshot('datasetproof.sales')
    await upgradeSales(admin, fixture, { guard: [guards[1]] })
    await fillWarehouse(withFigures(...month('2026-11', '1', '0', '0', '0')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({ status: 'activated' })
  })

  // Like the guard it belongs to, a period decides which refresh may replace
  // the copy, not what the copy holds.
  test('an upgrade that adds one keeps the last good copy, and guards it', async ({ admin }) => {
    const installed = await setupGuarded(admin, [{ kind: 'max_drop_pct', column: 'amount', value: 50 }])
    await fillWarehouse(withFigures(...month('2026-10', '100', '200', '300', '400')))
    const good = await buildSnapshot('datasetproof.sales')
    await upgradeSales(admin, installed, { guard: guards })
    expect((await activeSnapshot('datasetproof.sales'))?.row_id).toBe(good.snapshotId)
    await fillWarehouse(withFigures(...month('2026-10', '100', '100', '100', '100')))
    expect(await buildSnapshot('datasetproof.sales')).toMatchObject({
      status: 'refused', reason: 'sales: amount total dropped 60% (1,000 → 400), limit 50%' })
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
const outstanding: Promise<unknown>[] = []
const within = <T>(work: Promise<T>, ms = 3000) => {
  outstanding.push(work)
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('blocked: still waiting')), ms))])
}
/** Let every request a test started finish inside its sandbox, even when the
 *  test failed, so none writes after the sandbox has rolled back. */
const settle = (...more: Promise<unknown>[]) => Promise.allSettled([...outstanding.splice(0), ...more])

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
    } finally { call.release(); await settle(pending) }
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
    } finally { for (const call of calls) call.release(); await settle(...pending) }
    for (const answer of pending) expect(await answer).toEqual({ result: 'answered' })
  })

  const nothing = async () => {}
  const view = async (context: Context) => { await context.recordView({ dataset: 'sales' }) }
  test.for([
    ['its answer', nothing, nothing],
    ['its view record', nothing, view],
    // The view is held until the answer, and written only if the app still serves it then.
    ['a view it recorded before the wait', view, nothing],
  ] as const)('an app disabled while the handler waited has %s refused', async ([, before, after], { admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    const call = stall()
    app.hooks.run = async (context: Context) => {
      await before(context)
      call.entered()
      await call.gate
      await after(context)
      return 'answered'
    }
    const pending = reader.post(read + 'outside', { payload: {} })
    try {
      await call.inside
      await within(admin.post('/api/set_app_enabled', { name: 'datasetproof', enabled: false }))
    } finally { call.release(); await settle(pending) }
    await expect(pending).rejects.toMatchObject({ status: 403 })
    expect(await sql`select 1 from access_log where "user" = ${reader.user} and operation = 'view_report'`).toHaveLength(0)
  })

  test('an app now serving another version than the one a handler ran under has its answer refused', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const ran = await servingIdentity('datasetproof')
    await sql`update installed_app set artifact_digest = 'another-artifact' where name = 'datasetproof'`
    let written = false
    await expect(assertStillServing('datasetproof', ran, async () => { written = true })).rejects.toMatchObject({ type: 'ConflictError' })
    expect(written).toBe(false)
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

  test('with a guard of every kind is accepted at discovery', async () => {
    const copy = await mkdtemp(resolve('test/.dataset-proof-'))
    try {
      await cp(fixture, copy, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
      manifest.datasets[0].guard = [
        { kind: 'min_rows', value: 1 }, { kind: 'not_all_zero', column: 'amount' }, { kind: 'max_drop_pct', column: 'units', value: 50 },
        { kind: 'max_sum_drop_pct', column: 'amount', value: 50, within: 'business_day' }, { kind: 'max_drop_pct', column: 'units', value: 0, within: 'note' }]
      await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(manifest))
      expect(await discoverPackages([copy])).toEqual([])
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  })

  test.for([
    ['key is not one of its columns', { keys: ['plant_code', 'region'] }, /key region is not one of its columns/],
    ['scope filter maps to a money column', { filters: { store: 'amount' } }, /scope filter amount must be text, integer or date/],
    ['query holds a second statement', { query: 'select 1; drop table b4_dataset.sales' }, /one statement/],
    // #669: a guard is declarative, so the manifest is the only place it can be wrong.
    ['guard checks a column it does not declare', { guard: [{ kind: 'not_all_zero', column: 'target' }] }, /sales's guard column target is not one of its columns/],
    ['guard checks a text column', { guard: [{ kind: 'max_drop_pct', column: 'note', value: 50 }] }, /sales's guard column note must be integer, number or money/],
    ['guard allows a drop above 100%', { guard: [{ kind: 'max_drop_pct', column: 'amount', value: 150 }] }, /max_drop_pct value must be a whole percentage from 0 to 100/],
    ['guard asks for fewer than no rows', { guard: [{ kind: 'min_rows', value: -1 }] }, /min_rows value must be a whole number of rows, 0 or more/],
    ['guard names an unknown kind', { guard: [{ kind: 'max_rows', value: 10 }] }, /guard kind must be one of min_rows, not_all_zero, max_drop_pct/],
    ['guard counts rows of a column', { guard: [{ kind: 'min_rows', column: 'units', value: 1 }] }, /min_rows guard counts rows, so it names no column/],
    ['guard gives a value to a check that takes none', { guard: [{ kind: 'not_all_zero', column: 'units', value: 1 }] }, /not_all_zero guard takes no value/],
    ['guard allows a fractional drop', { guard: [{ kind: 'max_drop_pct', column: 'amount', value: 7.5 }] }, /max_drop_pct value must be a whole percentage from 0 to 100/],
    ['guard checks a drop without naming a column', { guard: [{ kind: 'max_drop_pct', value: 50 }] }, /max_drop_pct guard needs a column/],
    // #676: the sum guard is held to the same limits; `within` names a period column a drop guard compares inside.
    ['guard allows a total to drop above 100%', { guard: [{ kind: 'max_sum_drop_pct', column: 'amount', value: 101 }] }, /max_sum_drop_pct value must be a whole percentage from 0 to 100/],
    ['guard allows a total a fractional drop', { guard: [{ kind: 'max_sum_drop_pct', column: 'amount', value: 0.5 }] }, /max_sum_drop_pct value must be a whole percentage from 0 to 100/],
    ['guard sums without naming a column', { guard: [{ kind: 'max_sum_drop_pct', value: 50 }] }, /max_sum_drop_pct guard needs a column/],
    ['guard sums a text column', { guard: [{ kind: 'max_sum_drop_pct', column: 'note', value: 50 }] }, /sales's guard column note must be integer, number or money/],
    ['guard compares within a column it does not declare', { guard: [{ kind: 'max_sum_drop_pct', column: 'amount', value: 50, within: 'month' }] },
      /sales's guard within column month is not one of its columns/],
    ['guard compares within a money column', { guard: [{ kind: 'max_drop_pct', column: 'units', value: 50, within: 'amount' }] },
      /sales's guard within column amount must be text, integer or date/],
    ['guard compares a minimum within a period', { guard: [{ kind: 'min_rows', value: 1, within: 'business_day' }] }, /only a drop guard compares within a column/],
    ['guard checks for zeros within a period', { guard: [{ kind: 'not_all_zero', column: 'units', within: 'business_day' }] }, /only a drop guard compares within a column/],
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

  // #676: the stored copy keeps a figure's exact decimal for the guards'
  // sums, yet reads back as the very row a live read shapes.
  test('stores a row that reads back as its shaped row, with each figure\'s exact digits', () => {
    const probe = dataset([{ name: 'store', type: 'text' }, { name: 'amount', type: 'money' }, { name: 'ratio', type: 'number' },
      { name: 'units', type: 'integer' }, { name: 'gap', type: 'money' }])
    // Text that is not plain decimal ('0x10') keeps the shaped number.
    const raw = [
      { store: 'N1', amount: '9007199254740993.10', ratio: 0.25, units: 3, gap: null },
      { store: 'S1', amount: '-0012.5e1', ratio: '0x10', units: null, gap: '.5' },
    ]
    const json = storedRowJson(probe, raw)
    expect(json).toEqual([
      '{"store":"N1","amount":9007199254740993.10,"ratio":0.25,"units":3,"gap":null}',
      '{"store":"S1","amount":-12.5e1,"ratio":16,"units":null,"gap":0.5}',
    ])
    expect(json.map(row => JSON.parse(row))).toEqual(shapeRows(probe, raw))
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

// #669: what each guard kind says of a candidate's counts, against the
// active snapshot's. Counts are of rows, and of values in a column that are
// neither empty nor zero.
describe('a dataset guard', () => {
  const counts = (rows: number, target: number) => ({ rows, nonZero: { target }, sums: {}, periods: {} })
  const check = (guard: DatasetGuard, candidate: ReturnType<typeof counts>, previous: ReturnType<typeof counts> | null = null) =>
    guardRefusal('sales', [guard], candidate, previous)

  test.for([
    ['min_rows refuses fewer rows than it asks for', { kind: 'min_rows', value: 5 }, counts(4, 4), null, 'sales: 4 rows, at least 5 required'],
    ['min_rows passes the rows it asks for', { kind: 'min_rows', value: 5 }, counts(5, 5), null, null],
    ['not_all_zero refuses a column holding only empty or zero values', { kind: 'not_all_zero', column: 'target' }, counts(3, 0), null,
      'sales: every target value is empty or zero (3 rows)'],
    ['not_all_zero refuses a candidate with no rows', { kind: 'not_all_zero', column: 'target' }, counts(0, 0), null,
      'sales: every target value is empty or zero (0 rows)'],
    ['not_all_zero passes one value that is neither', { kind: 'not_all_zero', column: 'target' }, counts(3, 1), null, null],
    ['max_drop_pct passes a drop of exactly its limit', { kind: 'max_drop_pct', column: 'target', value: 50 }, counts(10, 600), counts(10, 1200), null],
    ['max_drop_pct refuses a drop just over its limit', { kind: 'max_drop_pct', column: 'target', value: 50 }, counts(10, 599), counts(10, 1200),
      'sales: target values dropped 50.1% (1,200 → 599), limit 50%'],
    ['max_drop_pct names a large drop in whole numbers', { kind: 'max_drop_pct', column: 'target', value: 50 }, counts(10, 336), counts(10, 1200),
      'sales: target values dropped 72% (1,200 → 336), limit 50%'],
    ['max_drop_pct passes a first refresh, with no active snapshot', { kind: 'max_drop_pct', column: 'target', value: 50 }, counts(10, 1), null, null],
    ['max_drop_pct passes a rise', { kind: 'max_drop_pct', column: 'target', value: 0 }, counts(10, 9), counts(10, 8), null],
  ] as const)('%s', ([, guard, candidate, previous, refusal]) => {
    expect(check(guard as DatasetGuard, candidate, previous)).toBe(refusal)
  })

  // A limit that is not exact in binary must still let a drop of exactly that much through.
  test.for([
    [3, 100, 97, true], [3, 100, 96, false],
    [7, 100, 93, true], [7, 100, 92, false],
    [33, 300, 201, true], [33, 300, 200, false],
  ] as const)('max_drop_pct %i%% from %i to %i passes: %s', ([limit, before, now, passes]) => {
    const refusal = check({ kind: 'max_drop_pct', column: 'target', value: limit }, counts(10, now), counts(10, before))
    expect(refusal === null).toBe(passes)
  })

  // #676: max_sum_drop_pct compares a column's total, exactly: the totals
  // are the snapshot's own decimal sums, never JavaScript floats.
  const totals = (target: string) => ({ rows: 10, nonZero: { target: 10 }, sums: { target }, periods: {} })
  const sumGuard = (value: number) => ({ kind: 'max_sum_drop_pct', column: 'target', value }) as DatasetGuard

  test.for([
    ['passes a drop of exactly its limit', 50, '12000000', '6000000', null],
    ['refuses a drop just over its limit', 50, '12000000', '5999999.99',
      'sales: target total dropped more than 50% (1,20,00,000 → 59,99,999.99), limit 50%'],
    ['names a large drop in Indian grouping', 50, '12000000', '4560000', 'sales: target total dropped 62% (1,20,00,000 → 45,60,000), limit 50%'],
    ['passes a rise', 0, '100.5', '100.51', null],
    ['passes any drop from a total of zero', 10, '0', '-500', null],
    ['passes any drop from a negative total', 10, '-100', '-500', null],
  ] as const)('max_sum_drop_pct %s', ([, limit, before, now, refusal]) => {
    expect(check(sumGuard(limit), totals(now), totals(before))).toBe(refusal)
  })

  test('max_sum_drop_pct passes a first refresh, with no active snapshot', () => {
    expect(check(sumGuard(50), totals('1'), null)).toBeNull()
  })

  // 0.57 * 100 is 56.99999999999999 in floating point, so a float comparison
  // would refuse a drop of exactly 43%; 0.1 + 0.2 is not 0.3.
  test.for([
    [43, '1.00', '0.57', true], [43, '1.00', '0.56', false],
    [50, '0.30', '0.15', true], [50, '0.30', '0.14', false],
    [7, '1234567.89', '1148148.1377', true], [7, '1234567.89', '1148148.1376', false],
  ] as const)('max_sum_drop_pct %i%% from %s to %s passes: %s', ([limit, before, now, passes]) => {
    expect(check(sumGuard(limit), totals(now), totals(before)) === null).toBe(passes)
  })

  // #676: `within` keeps a drop comparison inside one period, so the first
  // refresh of a new month is not compared with the last one.
  const inPeriod = (target: number, total: string, month: { distinct: number; empty: number; value: string | null }) =>
    ({ rows: 10, nonZero: { target }, sums: { target: total }, periods: { month } })
  const one = (value: string) => ({ distinct: 1, empty: 0, value })
  const countWithin = { kind: 'max_drop_pct', column: 'target', value: 50, within: 'month' } as DatasetGuard
  const sumWithin = { kind: 'max_sum_drop_pct', column: 'target', value: 50, within: 'month' } as DatasetGuard

  test.for([
    ['max_drop_pct refuses a drop over its limit in the same period', countWithin,
      'sales: target values dropped 90% (100 → 10), limit 50%'],
    ['max_sum_drop_pct refuses a drop over its limit in the same period', sumWithin,
      'sales: target total dropped 90% (1,000 → 100), limit 50%'],
  ] as const)('%s', ([, guard, refusal]) => {
    expect(check(guard, inPeriod(10, '100', one('2026-10-01')), inPeriod(100, '1000', one('2026-10-01')))).toBe(refusal)
  })

  test.for([
    ['max_drop_pct', countWithin], ['max_sum_drop_pct', sumWithin],
  ] as const)('%s passes the first refresh of a new period, however small', ([, guard]) => {
    expect(check(guard, inPeriod(10, '100', one('2026-11-01')), inPeriod(100, '1000', one('2026-10-01')))).toBeNull()
  })

  // An active snapshot that is not one period is no baseline for one.
  test('a drop within a period passes against an active snapshot holding more than one', () => {
    expect(check(sumWithin, inPeriod(10, '100', one('2026-10-01')), inPeriod(100, '1000', { distinct: 2, empty: 0, value: null }))).toBeNull()
  })

  // Declaring `within` says a complete refresh is one period: a candidate
  // that is not cannot be judged, so it is refused, even with no baseline.
  test.for([
    ['more than one value', { distinct: 2, empty: 0, value: null }, 'sales: month holds 2 values and 0 empty, but target is compared within one month'],
    ['an empty value', { distinct: 1, empty: 3, value: null }, 'sales: month holds 1 value and 3 empty, but target is compared within one month'],
  ] as const)('a candidate whose period column holds %s is refused', ([, month, refusal]) => {
    expect(check(sumWithin, inPeriod(10, '100', month), null)).toBe(refusal)
  })

  test('the first guard that fails is the one named', () => {
    expect(guardRefusal('sales', [{ kind: 'min_rows', value: 1 }, { kind: 'not_all_zero', column: 'target' }], counts(2, 0), null))
      .toBe('sales: every target value is empty or zero (2 rows)')
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

  test('a disabled app\'s datasets are not refreshed, and their asks are closed', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await recordMiss('datasetproof.sales')
    await admin.post('/api/set_app_enabled', { name: 'datasetproof', enabled: false })
    expect(await datasetsDue()).not.toContain('datasetproof.sales')
    expect(await pendingMisses()).not.toContain('datasetproof.sales')
  })

  // An upgrade that drops a dataset leaves the ask a reader made for it; the
  // refresh must not keep failing on a dataset nothing declares any more.
  test('after an upgrade drops a dataset a reader asked for, a refresh succeeds without trying it', async ({ admin, createUser }) => {
    await loadJobs()
    await setup(admin, createUser)
    const upgraded = await mkdtemp(resolve('test/.dataset-proof-'))
    try {
      await cp(fixture, upgraded, { recursive: true })
      const manifest = JSON.parse(await readFile(resolve(upgraded, 'featherbase.json'), 'utf8'))
      await writeFile(resolve(upgraded, 'featherbase.json'), JSON.stringify({ ...manifest,
        datasets: manifest.datasets.filter((d: { name: string }) => d.name !== 'accounts'),
        migrations: [{ id: 'drop_accounts', fromVersion: '1.0.0', toVersion: '1.1.0', operations: [] }] }))
      await writeFile(resolve(upgraded, 'package.json'), JSON.stringify({ name: 'featherbase-dataset-proof', version: '1.1.0', type: 'module' }))
      await recordMiss('datasetproof.accounts')
      expect(await discoverPackages([fixture, upgraded, provider])).toEqual([])
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'datasetproof', version: '1.1.0' })
      await admin.post('/api/upgrade_app', { name: 'datasetproof', version: '1.1.0', planId: plan.planId })
      await admin.post('/api/activate_app_upgrade', { name: 'datasetproof', version: '1.1.0' })
      expect(await datasetsDue()).not.toContain('datasetproof.accounts')
      await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
      await drainJobs()
      const runs = await sql`select outcome from job_execution where method = 'refresh_datasets'`
      expect(runs.map(r => r.outcome)).toEqual(['success'])
    } finally {
      await rm(upgraded, { recursive: true, force: true })
    }
  })
})

// #667: a place naming a filter a dataset cannot apply still adds no rows
// (fail closed), but the drop is visible: a System Manager can ask why a
// person sees nothing, and Instance health names what was dropped.
describe('a place a dataset cannot apply', () => {
  const FLOOR_PLACES = [{ label: 'North floor 1', filters: { store: ['N1'], floor: ['1'] } }, { label: 'South', filters: { store: ['S1'] } }]
  async function withPlaces<T>(places: unknown, work: () => Promise<T>): Promise<T> {
    const roster = await fixtureModule('placeroster', provider)
    roster.faults.result = places
    try { return await work() } finally { delete roster.faults.result }
  }
  interface ScopeExplanation {
    provider: { app: string; title: string } | null
    problem: string | null
    places: { label: string; filters: string[] }[]
    datasets: { name: string; applied: string[]; dropped: { place: string; keys: string[] }[] }[]
  }
  const scopeOf = (client: TestClient, person: string, app = 'datasetproof') =>
    client.get<ScopeExplanation>(`/api/people/${encodeURIComponent(person)}/scope?app=${app}`)

  test('a System Manager sees which places each dataset dropped, and the keys it could not apply', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const explained = await withPlaces(FLOOR_PLACES, () => scopeOf(admin, reader.user!))
    expect(explained.datasets.find(d => d.name === 'sales')).toEqual({
      name: 'sales', applied: ['South'], dropped: [{ place: 'North floor 1', keys: ['floor'] }] })
  })

  test.for(['the person being explained', 'another person without the System Manager role'] as const)(
    'is refused to %s', async (who, { admin, createUser }) => {
      const { reader } = await setup(admin, createUser)
      const asker = who === 'the person being explained' ? reader : await createUser({ email: 'other@example.test', roles: ['Dataset Reader'] })
      await withPlaces(FLOOR_PLACES, () => expectApiError(scopeOf(asker, reader.user!), { status: 403 }))
    })

  test.for([
    ['an empty scope', [], 'scope'],
    ['a scope of the wrong shape', [{ label: 'North' }], 'provider'],
  ] as const)('a provider answering %s is named as the reason, with no places', async ([, answer, reason], { admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    const explained = await withPlaces(answer, () => scopeOf(admin, reader.user!))
    expect({ problem: explained.problem, places: explained.places }).toEqual({ problem: reason, places: [] })
  })

  test.for([
    ['a person who does not exist', 'psn_nobody', 'datasetproof'],
    ['an app that is not installed', undefined, 'elsewhere'],
  ] as const)('answers not found for %s', async ([, person, app], { admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await withPlaces(FLOOR_PLACES, () => expectApiError(scopeOf(admin, person ?? reader.user!, app), { status: 404 }))
  })

  const dropsCheck = async () => (await runHealthChecks()).find(check => check.key === 'scope-place-drops:datasetproof')

  test('after a read drops a place, Instance health names the provider, the dataset and the keys', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'inside', { payload: {} }))
    expect(await dropsCheck()).toMatchObject({ ok: false, severity: 'warning',
      message: 'sales drops places from Place roster proof that name floor, which it cannot apply, so those places add nothing from it.' })
  })

  // Fail closed, as before: recording the drop changes no one's rows.
  test.for([['cached', 'inside', 'active'], ['live', 'outside', 'live']] as const)(
    'a %s read still gets nothing from the dropped place', async ([, operation, method], { admin, createUser }) => {
      const { reader, app } = await setup(admin, createUser)
      await buildSnapshot('datasetproof.sales')
      app.hooks.run = (context: Context) => context.datasets[method]('sales')
      const answer = await withPlaces(FLOOR_PLACES, () => reader.post<{ result: { rows: unknown[] } }>(read + operation, { payload: {} }))
      expect(answer.result.rows).toEqual([row('S1', 'kids', '2026-10-01', 40, 2, 'south kids')])
    })

  test('what a drop records names no person, place or filter value', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'inside', { payload: {} }))
    const recorded = await sql`select app, dataset, provider, filter_keys, app_version, provider_version from dataset_place_drop`
    expect(recorded.map(r => ({ ...r }))).toEqual([{ app: 'datasetproof', dataset: 'sales', provider: 'placeroster',
      filter_keys: ['floor'], app_version: '1.0.0', provider_version: '1.0.0' }])
    expect(JSON.stringify(await dropsCheck())).not.toContain(reader.user!)
  })

  // Codex round 1 on #678: a drop is recorded against the versions the read
  // was authorized under, and only once the read's answer stands.
  const recordedDrops = async () => (await sql`select app_version, provider_version from dataset_place_drop`).map(r => ({ ...r }))

  test('an outbound read records its drop once its answer stands', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'outside', { payload: {} }))
    expect(await recordedDrops()).toEqual([{ app_version: '1.0.0', provider_version: '1.0.0' }])
  })

  test('an outbound read refused because its app changed version meanwhile records no drop', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = async (context: Context) => {
      await sql`update installed_app set package_version = '1.1.0', artifact_digest = 'another-artifact' where name = 'datasetproof'`
      return context.datasets.active('sales')
    }
    await withPlaces(FLOOR_PLACES, () => expectApiError(reader.post(read + 'outside', { payload: {} }), { status: 409 }))
    expect(await recordedDrops()).toEqual([])
  })

  test('a drop is recorded against the provider version that answered, not one installed meanwhile', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = async (context: Context) => {
      await sql`update installed_app set package_version = '1.1.0', artifact_digest = 'another-artifact' where name = 'placeroster'`
      return context.datasets.active('sales')
    }
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'outside', { payload: {} }))
    expect(await recordedDrops()).toEqual([{ app_version: '1.0.0', provider_version: '1.0.0' }])
    expect(await dropsCheck()).toMatchObject({ ok: true })
  })

  // Adversarial round 1 on #678: a request may narrow its places by naming
  // filters, which adds those keys to them. Only the provider's own places
  // are recorded, so a reader cannot write a key into a health warning.
  test('filter keys a request names record no drop, a person-id-shaped one included', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await position(admin, reader.user!, 'North / Kids', 'N1', 'kids')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const answer = await reader.post<{ result: unknown }>(read + 'inside',
      { payload: { scope: { filters: { floor: ['1'], [reader.user!]: ['x'] } } } })
    expect(answer).toEqual({ result: null })
    expect(await recordedDrops()).toEqual([])
  })

  // Codex round 2 on #678: a place the request narrowed away never reached
  // the dataset, so it is not a drop this read met.
  test('a request narrowed to a place the dataset applies records no drop for the others', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'inside', { payload: { scope: { places: ['South'] } } }))
    expect(await recordedDrops()).toEqual([])
  })

  // Codex round 2 on #678: an outbound read authorized under an older
  // provider can finish after a read under the current one recorded the
  // same drop; the current record, and its warning, stay.
  test('a late write under an older provider version leaves the current drop and its warning', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await sql`update installed_app set package_version = '2.0.0' where name = 'placeroster'`
    const recorded = (provider: string) => ({ app: 'datasetproof', dataset: 'sales', keys: ['floor'],
      versions: { app: '1.0.0', provider: { app: 'placeroster', version: provider } } })
    await recordPlaceDrops([recorded('2.0.0')])
    await recordPlaceDrops([recorded('1.0.0')])
    expect(await dropsCheck()).toMatchObject({ ok: false })
  })

  test('a delayed outbound read under the older provider leaves the current drop\'s warning', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = async (context: Context) => {
      // While this read, authorized under provider 1.0.0, is out: the
      // provider moves to 2.0.0 and a read under it records the same drop.
      await sql`update installed_app set package_version = '2.0.0' where name = 'placeroster'`
      await recordPlaceDrops([{ app: 'datasetproof', dataset: 'sales', keys: ['floor'],
        versions: { app: '1.0.0', provider: { app: 'placeroster', version: '2.0.0' } } }])
      return context.datasets.active('sales')
    }
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'outside', { payload: {} }))
    expect((await recordedDrops()).map(r => r.provider_version).sort()).toEqual(['1.0.0', '2.0.0'])
    expect(await dropsCheck()).toMatchObject({ ok: false })
  })

  test('a read whose drop cannot be recorded still answers its rows', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    await sql`alter table dataset_place_drop rename to dataset_place_drop_away`
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const answer = await withPlaces(FLOOR_PLACES, () => reader.post<{ result: { rows: unknown[] } }>(read + 'inside', { payload: {} }))
    expect(answer.result.rows).toEqual([row('S1', 'kids', '2026-10-01', 40, 2, 'south kids')])
  })

  test('a writer holding the drop\'s row does not hold up the read', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    const held = stall()
    // Another connection, outside the sandbox, holds the row uncommitted.
    const holder = _getRootSql().begin(async tx => {
      await tx`insert into featherbase.dataset_place_drop (app, dataset, provider, filter_keys, app_version, provider_version)
        values ('datasetproof', 'sales', 'placeroster', ${['floor']}, '1.0.0', '1.0.0')`
      held.entered()
      await held.gate
      throw new Error('roll back')
    }).catch(() => {})
    await held.inside
    try {
      const answer = await withPlaces(FLOOR_PLACES, () => within(reader.post<{ result: { rows: unknown[] } }>(read + 'inside', { payload: {} })))
      expect(answer.result.rows).toEqual([row('S1', 'kids', '2026-10-01', 40, 2, 'south kids')])
    } finally {
      held.release()
      await settle(holder)
    }
  })

  test('before any read drops a place, the check passes', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    expect(await dropsCheck()).toMatchObject({ ok: true })
  })

  test('explaining a person\'s scope records no drop', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await withPlaces(FLOOR_PLACES, () => scopeOf(admin, reader.user!))
    expect(await dropsCheck()).toMatchObject({ ok: true })
  })

  test('a drop seen under an earlier version of the app no longer counts', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    app.hooks.run = (context: Context) => context.datasets.active('sales')
    await withPlaces(FLOOR_PLACES, () => reader.post(read + 'inside', { payload: {} }))
    await upgradeSales(admin, fixture, {})
    expect(await dropsCheck()).toMatchObject({ ok: true })
  })

  test('an app with no datasets gets no check', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const keys = (await runHealthChecks()).map(check => check.key).filter(key => key.startsWith('scope-place-drops:'))
    expect(keys).toEqual(['scope-place-drops:datasetproof'])
  })

  test('the Access Log records which System Manager looked at whose places, for which app', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await withPlaces(FLOOR_PLACES, () => scopeOf(admin, reader.user!))
    const rows = await sql`select "user", ref_table, reference_name, method from access_log where operation = 'view_person_scope'`
    expect(rows.map(r => ({ ...r }))).toEqual([{ user: admin.user, ref_table: 'Person', reference_name: reader.user, method: 'datasetproof' }])
  })

  // Built, so there are figures it could leak; the whole answer is pinned.
  test('the explanation holds the provider, place labels and filter keys, and nothing else', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await buildSnapshot('datasetproof.sales')
    const explained = await withPlaces(FLOOR_PLACES, () => scopeOf(admin, reader.user!))
    expect(explained).toEqual({
      provider: { app: 'placeroster', title: 'Place roster proof' },
      problem: null,
      places: [{ label: 'North floor 1', filters: ['floor', 'store'] }, { label: 'South', filters: ['store'] }],
      datasets: [
        { name: 'sales', applied: ['South'], dropped: [{ place: 'North floor 1', keys: ['floor'] }] },
        { name: 'accounts', applied: [], dropped: [
          { place: 'North floor 1', keys: ['floor', 'store'] }, { place: 'South', keys: ['store'] }] },
        { name: 'unplugged', applied: ['South'], dropped: [{ place: 'North floor 1', keys: ['floor'] }] },
      ],
    })
  })
})

// Adversarial round 1 on #678: recording a drop runs on its own transaction,
// in one order, with short timeouts. These need real connections, so they
// commit under a made-up app name and clean up after themselves.
describe('recording a dropped place', () => {
  const root = _getRootSql()
  const drop = (dataset: string, keys: string[]): PlaceDrop =>
    ({ app: 'droptest', dataset, keys, versions: { app: '1.0.0', provider: { app: 'droproster', version: '1.0.0' } } })
  const cleanUp = () => root`delete from featherbase.dataset_place_drop where app = 'droptest'`

  test('two recordings of overlapping drops in opposite orders both complete', async () => {
    try {
      const one = [drop('a', ['floor']), drop('b', ['section']), drop('c', ['zone'])]
      const results = await Promise.all([recordPlaceDrops(one, root), recordPlaceDrops([...one].reverse(), root)])
      expect(results.reduce((a, b) => a + b)).toBe(3)
      expect((await root`select count(*)::int as n from featherbase.dataset_place_drop where app = 'droptest'`)[0].n).toBe(3)
    } finally { await cleanUp() }
  })

  test('two recordings of the same stale drop update it once', async () => {
    try {
      await root`insert into featherbase.dataset_place_drop (app, dataset, provider, filter_keys, app_version, provider_version, last_seen)
        values ('droptest', 'a', 'droproster', ${['floor']}, '1.0.0', '1.0.0', now() - interval '2 hours')`
      // A third connection holds the row while both read it as stale, then
      // lets go well inside their lock timeout, so both reach the write.
      const held = stall()
      const holder = root.begin(async tx => {
        await tx`select 1 from featherbase.dataset_place_drop where app = 'droptest' for update`
        held.entered()
        await held.gate
      })
      await held.inside
      const both = Promise.all([recordPlaceDrops([drop('a', ['floor'])], root), recordPlaceDrops([drop('a', ['floor'])], root)])
      await new Promise(resolve => setTimeout(resolve, 60))
      held.release()
      await holder
      const results = await both
      expect(results.reduce((a, b) => a + b)).toBe(1)
    } finally { await cleanUp() }
  })
})
