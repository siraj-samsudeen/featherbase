// Feather Dash's report reads on the real platform: the reader's places come
// from the app's own scope provider, and the platform limits the cached
// dataset to them before the app sees a row. The cached copy is seeded the
// way the platform stores one (the warehouse is MotherDuck, which a test
// cannot reach). Made-up stores 9901 (live) and 9902, people and figures.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { applySeedPack } from '../../src/seed-packs'
import { datasetsDeclaration } from '../../src/app-datasets'
import { invalidateSources } from '../../src/sources/registry'
import { withNamedVariable } from '../../src/env'
import { sql } from '../../src/db'
import { activeSnapshot, buildSnapshot } from '../../src/dataset-snapshot'
import { drainJobs, enqueue, loadJobs } from '../../src/jobs'
import { APP_DIR, createOldTables, installApp, pinned, saveRow } from './helpers'
import { FOUR_TARGETS, addSource, answerWithoutPeriod, closeWarehouse, fillWarehouse, openWarehouse } from './warehouse'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner
import { markScopeTables } from './mark-scope-tables.mjs'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const READER = 'Feather Dash Reader'
// A declared secret is required by every read (featherbase app-settings.ts), so the
// instance sets the token even where no Dive is configured.
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const periodStart = `${today.slice(0, 8)}01`

const salesRow = (store: string, code: string, name: string, target: number, actual: number) => ({
  store_code: store, store_name: name, short_code: null, subcategory_code: code, subcategory: `Made-up ${code}`, target, actual,
  days_with_actual: 3, days: 3, period_start: periodStart, data_through: today, targets_available: true })

/** A cached copy of the app's dataset, stored as the platform stores one, under the definition it registered. */
async function seedSnapshot(rows: Record<string, unknown>[], name = 'sales_to_date') {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'featherbase.json'), 'utf8'))
  const dataset = datasetsDeclaration.parse(manifest.datasets).find(d => d.name === name)!
  // As the platform keys it (featherbase app-datasets.ts): a guard is not part of the definition.
  const version = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16)
  await sql`update dataset_snapshot set state = 'superseded' where dataset = ${`feather_dash.${name}`} and state = 'active'`
  const id = randomUUID()
  await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
    values (${id}, ${`feather_dash.${name}`}, ${version}, 'active', now(), now(), ${rows.length})`
  for (const row of rows) await sql`insert into app_dataset_row (snapshot_id, row) values (${id}, ${sql.json(row)})`
}

async function setup(admin: TestClient, createUser: CreateUserFn, facts?: Record<string, unknown>[]) {
  await applySeedPack('jeyarama')
  await installApp(admin)
  // Until every store is live the provider reads the old Tables, so an instance has them, marked.
  await createOldTables(admin, markScopeTables)
  invalidateSources()
  // The instance's MotherDuck source, played by a local DuckDB path: the platform
  // accepts it as read-only. The reads never query it; a refresh below queries the
  // made-up warehouse instead (warehouse.ts).
  await addSource(admin)
  const user = async (name: string) => createUser({ email: `${name}@example.test`, roles: [READER] })
  const people = { manager: await user('p-101'), leader: await user('p-103'), nobody: await user('p-999') }
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  await save('store_rollout', { store: '9901', live_since: '2026-01-01' })
  const sarees = await save('section', { store: '9901', section_name: 'Sarees' })
  const lehenga = await save('section', { store: '9901', section_name: 'Lehenga' })
  await save('section_subcategory', { store: '9901', subcategory: '010101001', section: sarees.row_id, starts_on: '2026-01-01' })
  await save('section_subcategory', { store: '9901', subcategory: '010101003', section: lehenga.row_id, starts_on: '2026-01-01' })
  await save('job_assignment', { person: people.manager.user, job: 'Store Manager', store: '9901', starts_on: '2026-01-01' })
  await save('job_assignment', { person: people.leader.user, job: 'Team Leader', store: '9901', section: sarees.row_id, starts_on: '2026-01-01' })
  await seedSnapshot(facts ?? [
    salesRow('9901', '010101001', 'Lakeside', 1000, 800),
    salesRow('9901', '010101003', 'Lakeside', 500, 650),
    salesRow('9901', '010909001', 'Lakeside', 0, 120),
    salesRow('9902', '010404001', 'Hillview', 300, 100),
  ])
  // The month's metadata, which also names the stores for the bar.
  await seedSnapshot(['010101001', '010101003', '010909001'].map(code => ({ store_code: '9901', store_name: 'Lakeside', subcategory_code: code,
    period_start: periodStart, data_through: today, targets_available: true })), 'sales_month')
  return people
}

const report = (client: TestClient, payload: Record<string, unknown> = { store: '9901' }) =>
  client.post<{ result: { state: string; rows: { code: string; section: string | null }[] } }>('/api/app_reads/feather_dash/report', { payload }).then(a => a.result)

describe('the report reads on the platform', () => {
  test("give a Store Manager every cached row of their store, each in its section", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    const answer = await report(manager)
    expect([answer.state, answer.rows.map(r => [r.section, r.code])]).toEqual(['ready',
      [['Lehenga', '010101003'], ['Sarees', '010101001'], [null, '010909001']]])
  })

  test("give a Team Leader only their section's rows: the platform limits the dataset to their places", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect((await report(leader)).rows.map(r => r.code)).toEqual(['010101001'])
  })

  // #4486: the places' `basis` survives the platform's narrowing into the read, so the page can say why.
  test("say why each reader sees the store, from the bases on their places", async ({ admin, createUser }) => {
    const { manager, leader } = await setup(admin, createUser)
    const heading = (client: TestClient) => client.post<{ result: { heading: unknown } }>('/api/app_reads/feather_dash/report', { payload: { store: '9901' } })
      .then(a => a.result.heading)
    expect(await heading(manager)).toEqual({ name: 'Lakeside', sections: ['Lehenga', 'Sarees'], reasons: [{ basis: 'store_manager', sections: ['Lehenga', 'Sarees'] }] })
    expect(await heading(leader)).toEqual({ name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  test("refuse a store that is not the reader's", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await expect(report(leader, { store: '9902' })).rejects.toMatchObject({ status: 417 })
  })

  test("show a quiet section as ready, from the month's metadata, when the store's month has arrived", async ({ admin, createUser }) => {
    // Sarees sold nothing and had no target: the Team Leader's scoped rows are empty.
    const { leader } = await setup(admin, createUser, [salesRow('9901', '010101003', 'Lakeside', 500, 650)])
    await seedSnapshot(['010101001', '010101003'].map(code => ({ store_code: '9901', store_name: 'Lakeside', subcategory_code: code, period_start: periodStart,
      data_through: today, targets_available: true })), 'sales_month')
    const answer = await report(leader)
    expect([answer.state, answer.rows.map(r => r.code)]).toEqual(['ready', ['010101001']])
  })

  test('refuse a person who covers nothing', async ({ admin, createUser }) => {
    const { nobody } = await setup(admin, createUser)
    await expect(report(nobody)).rejects.toMatchObject({ status: 403 })
  })

  test("fill the bar's store picker with the reader's stores", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    expect(await manager.get('/api/app_bar/feather_dash')).toEqual({ controls: [{ picker: 'Store', sets: 'store', options: [{ value: '9901', label: 'Lakeside' }] }] })
  })

  test('say the Dive is not set up while the instance has no Dive settings, so the page shows the quick view', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect(await leader.post('/api/app_reads/feather_dash/embed_session', { payload: { store: '9901' } })).toEqual({ result: { not_set_up: true } })
  })

  test('answer "not set up" to every read while the MotherDuck token is missing', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await expect(report(leader)).rejects.toMatchObject({ status: 409 })
    })
  })

  test('record each opening of the report in the Access Log', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await report(leader)
    const [logged] = await sql`select ref_table, method from access_log where "user" = ${leader.user} and operation = 'view_report'`
    expect(logged).toMatchObject({ ref_table: 'feather_dash.sales_to_date', method: 'cached' })
  })
})

// The old report's checks (featherbase sales-target-mtd.ts `validate`), declared as the
// dataset's guard: a refresh with no target at all, or with under half the targets of the active
// snapshot, is a failed or partial upstream build, so the last good snapshot keeps serving. The
// drops compare within one period_start (featherbase #676), as the old check did by keying its
// snapshots by month; the total catches a mart rebuilt for only some days.
describe("a refresh of the sales figures, checked like the old report's", () => {
  const SALES = 'feather_dash.sales_to_date'
  beforeEach(openWarehouse)
  afterEach(closeWarehouse)

  /** The store's figures, refreshed from a warehouse with four targets. */
  async function goodSnapshot(admin: TestClient, createUser: CreateUserFn) {
    const people = await setup(admin, createUser)
    await fillWarehouse(FOUR_TARGETS)
    const good = await buildSnapshot(SALES)
    expect(good).toMatchObject({ status: 'activated' })
    return { ...people, good }
  }

  test('keeps serving the last good snapshot when every target of a refresh is empty or zero', async ({ admin, createUser }) => {
    const { manager, good } = await goodSnapshot(admin, createUser)
    const served = await report(manager)
    await fillWarehouse({ '010101001': 0, '010101003': null, '010909001': 0, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: every target value is empty or zero (4 rows)' })
    expect([(await activeSnapshot(SALES))?.row_id, await report(manager)]).toEqual([good.snapshotId, served])
  })

  test("fails the refresh job with the guard's reason when no target arrives", async ({ admin, createUser }) => {
    await loadJobs()
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': null, '010101003': null, '010909001': null, '010303001': null })
    await enqueue('refresh_datasets')
    await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
    await drainJobs()
    const [run] = await sql`select outcome, error from job_execution where method = 'refresh_datasets'`
    expect([run.outcome, run.error]).toEqual(['error', expect.stringContaining(
      'feather_dash.sales_to_date: refused — sales_to_date: every target value is empty or zero (4 rows)')])
  })

  // The dataset's definition does not change with the month, so the first refresh of a month is
  // compared with last month's snapshot. A month that starts with fewer targeted subcategories is
  // still a complete month, and must replace last month's figures (Codex round 1 on #4450).
  test("activates this month's first refresh against last month's snapshot, however few its targets", async ({ admin, createUser }) => {
    const lastMonth = new Date(Date.UTC(Number(periodStart.slice(0, 4)), Number(periodStart.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
    const ofLastMonth = (row: Record<string, unknown>) => ({ ...row, period_start: lastMonth, data_through: periodStart })
    const { manager } = await setup(admin, createUser, Object.entries(FOUR_TARGETS).map(([code, target]) =>
      ofLastMonth(salesRow('9901', code, 'Lakeside', target, 100))))
    await fillWarehouse({ '010101001': 1000, '010101003': null, '010909001': null, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'activated' })
    expect((await report(manager)).state).toBe('ready')
  })

  test('keeps the last good snapshot when the targeted subcategories drop by more than half within the month', async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 1000, '010101003': null, '010909001': 0, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target values dropped 75% (4 → 1), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh whose targeted subcategories drop by exactly half within the month', async ({ admin, createUser }) => {
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 1000, '010101003': 500, '010909001': null, '010303001': null })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })

  // A mart rebuilt for only some days: every subcategory keeps a target, so the count holds,
  // but the month's summed target collapses.
  test("keeps the last good snapshot when the month's total target drops by more than half", async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 300, '010101003': 150, '010909001': 60, '010303001': 30 })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target total dropped 70% (1,800 → 540), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  // The old report counted target day rows. A rebuild that loses most of them can keep every
  // targeted subcategory and most of the amount; `target_days`, summed, is that old count (#4449).
  const SIX_ZERO_TARGETS = Object.fromEntries(['010505001', '010505002', '010505003', '010505004', '010505005', '010505006'].map(code => [code, 0]))
  const SIX_LOST = Object.fromEntries(Object.keys(SIX_ZERO_TARGETS).map(code => [code, null]))

  test('keeps the last good snapshot when more than half the target days are lost, though the targeted subcategories and the total hold', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_ZERO_TARGETS })
    const good = await buildSnapshot(SALES)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_LOST })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target_days total dropped 60% (10 → 4), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh that keeps its target days and its total target', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_ZERO_TARGETS })
    await buildSnapshot(SALES)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': 1100, ...SIX_ZERO_TARGETS })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })

  // Codex's case: uneven daily targets (festivals, weekdays). A rebuild keeps the three
  // high-target days of ten in Silk sarees and loses seven low ones: 7 of the store's 13 target
  // day rows, but under a tenth of the amount, and every subcategory keeps a target. It needs
  // ten days of the month behind it, so it runs from the 10th.
  test.skipIf(Number(today.slice(8, 10)) < 10)('keeps the last good snapshot when a rebuild keeps only the high-target days', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const low = Array<number>(7).fill(50)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': [1000, 1000, 1000, ...low] })
    const good = await buildSnapshot(SALES)
    expect(good).toMatchObject({ status: 'activated' })
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': [1000, 1000, 1000, ...low.map(() => null)] })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target_days total dropped 53.8% (13 → 6), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('refuses a refresh whose rows carry no period_start', async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse(FOUR_TARGETS)
    answerWithoutPeriod()
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused',
      reason: 'sales_to_date: period_start holds 0 values and 4 empty, but target is compared within one period_start' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh with every target present', async ({ admin, createUser }) => {
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': 1200 })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })
})
