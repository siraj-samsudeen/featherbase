// #1418: read-only copies, beyond the bound scenarios (test/scenarios/
// read-only-copies.test.ts): the declaration's rules, a copy following its
// app's versions, every way a load is refused or skipped, pruning, the
// schedule and check-now branches, the new-load context and DuckDB.
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from './pg-test'
import { _getRootSql, sql } from '../src/db'
import { runOneJob } from '../src/jobs'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { datasetsDeclaration } from '../src/app-datasets'
import { duckFamily } from '../src/sources/duckdb-driver'
import { checkCopy, loadMoves } from '../src/read-only-copy'
import { LOAD_JOB } from '../src/read-only-copy-loads'
import { discoverPackages } from '../src/runtime-packages'
import { expectRefused } from './fixtures'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import {
  APP, LINES, SALES, Warehouse, dailySales, forecastLines, install, jobCalls, load, loadState, readLines, removeFolders, requestAndRun, rows, upgrade, writeApp, type Line,
} from './read-only-copy-app'

const warehouse = new Warehouse('b4_copy_unit')
beforeAll(() => warehouse.create())
afterAll(() => warehouse.drop())
afterEach(removeFolders)

const LKS: Line = ['Dec-1', 'LKS', 'GJ01', '2026-12-01', '1000.00']
const RVR: Line = ['Dec-1', 'RVR', 'GJ01', '2026-12-01', '800.00']
const dec2 = (line: Line, value = line[4]): Line => ['Dec-2', line[1], line[2], line[3], value]
const lines = (more: Record<string, unknown> = {}) => forecastLines(warehouse.schema, more)
const loads = async (target = LINES) => (await sql`select state, error from dataset_snapshot where dataset = ${target} order by built_at`)
  .map((r) => r.state)
const parts = async () => (await sql`select tablename from pg_tables where schemaname = 'featherbase_copy' and tablename like 'l\\_%'`).length
const parse = (datasets: unknown[]) => {
  const parsed = datasetsDeclaration.safeParse(datasets)
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message)
}

async function installed(admin: Parameters<typeof install>[0], datasets: Record<string, unknown>[] = [lines()], published: Line[] = [LKS]) {
  const dir = await writeApp(datasets)
  await install(admin, dir)
  await warehouse.publish('Dec-1', published)
  return dir
}

describe('the declaration', () => {
  test('a typed copy names its row key with key-like columns, and a name a Table can carry', () => {
    expect(parse([lines({ rowKey: undefined })])).toEqual(['Dataset forecast_line_day becomes a Table, so it names its rowKey'])
    expect(parse([lines({ rowKey: ['nowhere'] })])).toEqual(["Dataset forecast_line_day's row key nowhere is not one of its columns"])
    expect(parse([lines({ rowKey: ['value'] })])).toEqual(["Dataset forecast_line_day's row key value must be text, integer or date"])
    expect(parse([lines({ name: 'a_dataset_name_that_is_far_too_long' })])).toEqual(['Dataset a_dataset_name_that_is_far_too_long becomes a Table, so its name is at most 31 characters'])
    const own = lines({ columns: [...(lines().columns as unknown[]), { name: 'snapshot_id', type: 'text' }, { name: 'created_at', type: 'date' }] })
    expect(parse([own])).toEqual([
      'Dataset forecast_line_day becomes a Table, whose own column snapshot_id it cannot declare',
      'Dataset forecast_line_day becomes a Table, whose own column created_at it cannot declare',
    ])
  })

  test('a JSON dataset takes none of a copy’s fields or guards', () => {
    expect(parse([lines({ store: 'json', guard: [{ kind: 'source_total', column: 'value' }] })])).toEqual([
      'Dataset forecast_line_day is stored as JSON, so it takes no rowKey',
      'Dataset forecast_line_day is stored as JSON, so it takes no runKey',
      'Dataset forecast_line_day is stored as JSON, so it takes no loadRoles',
      'Dataset forecast_line_day is stored as JSON, so it cannot check source_total',
    ])
    expect(parse([lines({ store: 'json', rowKey: undefined, runKey: undefined, loadRoles: undefined, onNewLoad: 'carry_changes' })]))
      .toEqual(['Dataset forecast_line_day is stored as JSON, so it takes no onNewLoad'])
  })

  test('the copy guards name a fitting column and take no value', () => {
    expect(parse([lines({ guard: [{ kind: 'keeps_values', column: 'value' }] })])).toEqual(["Dataset forecast_line_day's keeps_values column value must be text, integer or date"])
    expect(parse([lines({ guard: [{ kind: 'keeps_values', column: 'nowhere' }] })])).toEqual(["Dataset forecast_line_day's guard column nowhere is not one of its columns"])
    expect(parse([lines({ guard: [{ kind: 'source_total', column: 'store_code' }] })])).toEqual(["Dataset forecast_line_day's guard column store_code must be integer, number or money"])
    expect(parse([lines({ guard: [{ kind: 'source_total', column: 'value', value: 5 }] })])).toEqual(['A source_total guard takes no value'])
  })

  test('a copy lets only the app’s own roles load it', async () => {
    expect(JSON.stringify(await discoverPackages([await writeApp([lines({ loadRoles: ['Somebody Else'] })])])))
      .toContain("Dataset forecast_line_day lets Somebody Else load it, which is not one of the app's roles")
  })

  test('a new-load job is one the app declares, and a copy is not also one of its Tables', async () => {
    const problems = await discoverPackages([await writeApp([lines({ onNewLoad: 'nobody' })])])
    expect(JSON.stringify(problems)).toContain('Dataset forecast_line_day tells the job nobody about new loads, which the app does not declare in its jobs')
    const twice = await writeApp([lines({ name: 'note', columns: [{ name: 'body', type: 'text' }], rowKey: ['body'], keys: ['body'], filters: { store: 'body' }, runKey: undefined })])
    expect(JSON.stringify(await discoverPackages([twice]))).toContain('Dataset note is a read-only copy, so the app cannot also declare a Table copyproof.note')
  })
})

/** The app at `dir`, also granting Copy Reader read on its forecast lines. */
async function grantingRead(dir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(dir, 'featherbase.json'), 'utf8'))
  manifest.permissions.push({ table: LINES, role: 'Copy Reader', can_read: true })
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest))
  return dir
}

describe('a copy follows its app', () => {
  test('the app may grant its own roles read on a copy, at install', async ({ admin, createUser }) => {
    await install(admin, await grantingRead(await writeApp([lines()])))
    await warehouse.publish('Dec-1', [LKS])
    await load(LINES)
    const reader = await createUser({ roles: ['Copy Reader'] })
    expect(await reader.get(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`)).toMatchObject({ run_id: 'Dec-1' })
  })

  test('the app may grant its own roles read on a copy an upgrade adds', async ({ admin, createUser }) => {
    const first = await writeApp([dailySales(warehouse.schema)])
    await install(admin, first)
    await upgrade(admin, first, await grantingRead(await writeApp([dailySales(warehouse.schema), lines()], '1.1.0')), '1.1.0')
    expect(await sql`select role from permission where ref_table = ${LINES}`).toEqual([{ role: 'Copy Reader' }])
    await warehouse.publish('Dec-1', [LKS])
    await load(LINES)
    const reader = await createUser({ roles: ['Copy Reader'] })
    const res = await reader.fetch(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`,
      { headers: { 'X-Featherbase-App-Version': `${APP}@1.1.0` } })
    expect(await res.json()).toMatchObject({ run_id: 'Dec-1' })
  })

  test('a changed type rebuilds it empty until someone loads it; a dropped column goes', async ({ admin }) => {
    const first = await installed(admin)
    expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    const retyped = lines({
      query: `select run_id, store_code, subcategory_code, sale_date, value::text as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}`,
      columns: [{ name: 'run_id', type: 'text' }, { name: 'store_code', type: 'text' }, { name: 'subcategory_code', type: 'text' }, { name: 'sale_date', type: 'date' }, { name: 'value', type: 'text' }],
    })
    await sql`delete from background_job where job_status = 'queued'`
    await upgrade(admin, first, await writeApp([retyped], '1.1.0'), '1.1.0')
    expect(await rows(LINES)).toEqual([])
    expect(await loads()).toEqual([])
    // Nothing loads on its own (design D5).
    expect(await sql`select 1 from background_job where job_status = 'queued' and method = ${LOAD_JOB}`).toEqual([])
    expect(await load(LINES)).toMatchObject({ status: 'loaded', previous: null })
    expect(await rows(LINES)).toMatchObject([{ value: '1000.00' }])
    const dropped = { ...retyped, columns: (retyped.columns as { name: string }[]).filter((c) => c.name !== 'run_id') }
    await upgrade(admin, first, await writeApp([dropped], '1.2.0'), '1.2.0')
    expect((await rows(LINES))[0]).not.toHaveProperty('run_id')
    expect((await sql`select column_name from column_def where parent = ${LINES} order by position`).map((c) => c.column_name))
      .toEqual(['store_code', 'subcategory_code', 'sale_date', 'value'])
  })

  test('a JSON dataset that becomes a copy leaves its snapshots behind', async ({ admin }) => {
    const first = await installed(admin, [lines({ store: 'json', rowKey: undefined, runKey: undefined, loadRoles: undefined, query: `select * from ${warehouse.schema}.forecast_line_day` })])
    await sql`insert into dataset_snapshot (row_id, dataset, state, built_at, activated_at) values ('json-snapshot', ${LINES}, 'active', now(), now())`
    await upgrade(admin, first, await writeApp([lines({ guard: [{ kind: 'keeps_values', column: 'store_code' }] })], '1.1.0'), '1.1.0')
    expect(await loads()).toEqual([])
    expect(await load(LINES)).toMatchObject({ status: 'loaded', previous: null })
  })

  test('a dataset the app stops declaring goes', async ({ admin }) => {
    const first = await installed(admin, [lines(), dailySales(warehouse.schema)])
    expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    await upgrade(admin, first, await writeApp([dailySales(warehouse.schema)], '1.1.0'), '1.1.0')
    expect(await sql`select 1 from table_def where name = ${LINES}`).toEqual([])
    expect(await sql`select 1 from pg_class where relname = 'copyproof__forecast_line_day'`).toEqual([])
    expect(await parts()).toBe(0)
    expect(await sql`select 1 from scheduled_job where description like '%copyproof.forecast_line_day%'`).toEqual([])
    expect((await sql`select target_table from featherbase.table_copy where target_table like 'copyproof.%'`).map((r) => r.target_table)).toEqual([SALES])
  })
})

describe('a load', () => {
  test('is refused when the run check names no run, or more than one', async ({ admin }) => {
    await installed(admin)
    await warehouse.db.unsafe(`truncate ${warehouse.schema}.forecast_run`)
    expect(await load(LINES)).toMatchObject({ status: 'refused', reason: 'forecast_line_day: the run check answered no row; it names one run' })
    await warehouse.db.unsafe(`insert into ${warehouse.schema}.forecast_run values ('Dec-1', 'official'), ('Dec-2', 'official')`)
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: the run check answered more than one row; it names one run' })
    expect(await loads()).toEqual(['failed', 'failed'])
  })

  test('is refused when its query names a value the run check does not answer', async ({ admin }) => {
    await installed(admin, [lines({ query: `select * from ${warehouse.schema}.forecast_line_day where run_id = {run}` })])
    expect(await load(LINES)).toMatchObject({ status: 'refused', reason: 'forecast_line_day: the query names {run}, which the run check does not answer' })
  })

  test('is refused when a column holds another kind of value, naming both', async ({ admin }) => {
    await installed(admin, [lines({ query: `select run_id, store_code, subcategory_code, sale_date, value::text as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}` })])
    expect(await load(LINES)).toMatchObject({ status: 'refused', reason: 'forecast_line_day: value is text in the source, not money. The last good load is kept' })
  })

  test('is refused a source total on a float column, which no exact total can check', async ({ admin }) => {
    await installed(admin, [lines({ guard: [{ kind: 'source_total', column: 'value' }],
      query: `select run_id, store_code, subcategory_code, sale_date, value::float8 as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}` })])
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: value is double precision in the source, so its total cannot be checked exactly; make it a decimal there or drop the source_total guard. The last good load is kept' })
  })

  test('refused again and again keeps only the last ten refusals', async ({ admin }) => {
    await installed(admin)
    await warehouse.db.unsafe(`truncate ${warehouse.schema}.forecast_run`)
    for (let i = 0; i < 12; i++) await load(LINES)
    expect(await loads()).toEqual(Array(10).fill('failed'))
  })

  test('is indexed on its row id and its key and scope columns', async ({ admin }) => {
    await installed(admin)
    const { snapshot } = await load(LINES)
    const indexes = await sql`select indexdef from pg_indexes where tablename = ${`l_${snapshot!.replaceAll('-', '')}`}`
    expect(indexes.map((i) => String(i.indexdef).replace(/^.* USING /, ''))).toEqual(expect.arrayContaining(['btree (row_id)', 'btree (store_code)', 'btree (sale_date)']))
  })

  test('is refused when a source type is none it knows', async ({ admin }) => {
    await installed(admin, [lines({ query: `select run_id, store_code, subcategory_code, sale_date, array[value] as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}` })])
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: value is type 1231 in the source, not money. The last good load is kept' })
  })

  test('that the source stops partway fails, so its job retries, and keeps nothing', async ({ admin }) => {
    await installed(admin, [lines({ query: `select run_id, store_code, subcategory_code, sale_date,
      case when store_code = 'RVR' then value / 0 else value end as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}` })], [LKS, RVR])
    await expect(load(LINES)).rejects.toThrow('division by zero')
    expect(await rows(LINES)).toEqual([])
    expect(await parts()).toBe(0)
  })

  test('that cannot reach its relation fails, so its job retries', async ({ admin }) => {
    await installed(admin, [lines({ query: 'select * from nowhere.forecast_line_day where run_id = {run_id}' })])
    await expect(load(LINES)).rejects.toThrow(/relation "nowhere.forecast_line_day" does not exist/)
  })

  test('is refused when it is empty, or a row has no key', async ({ admin }) => {
    await installed(admin, [lines()], [])
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: the query returned no rows; the last good load is kept' })
    await warehouse.publish('Dec-1', [['Dec-1', 'LKS', null as never, '2026-12-01', '1.00']])
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: a row has an empty key; every row names its store_code, subcategory_code, sale_date' })
    expect(await parts()).toBe(0)
  })

  test('is refused by a guard the app declared', async ({ admin }) => {
    await installed(admin, [lines({ guard: [{ kind: 'not_all_zero', column: 'value' }, { kind: 'max_sum_drop_pct', column: 'value', value: 50, within: 'run_id' }] })], [[...LKS.slice(0, 4), '0.00'] as Line])
    expect(await load(LINES)).toMatchObject({ reason: 'forecast_line_day: every value value is empty or zero (1 rows)' })
  })

  test('is refused when the source’s own total is not the loaded one', async ({ admin }) => {
    // The source answers a different total each time it is asked.
    const restless = lines({
      query: `select run_id, store_code, subcategory_code, sale_date, value + floor(random() * 1000)::numeric + 1 as value from ${warehouse.schema}.forecast_line_day where run_id = {run_id}`,
      guard: [{ kind: 'source_total', column: 'value' }],
    })
    await installed(admin, [restless])
    const outcome = await load(LINES)
    expect(outcome).toMatchObject({ status: 'refused' })
    expect(outcome.reason).toMatch(/^forecast_line_day: value totals [\d.]+ here but [\d.]+ in the source$/)
  })

  test('that a stopped server left half made is dropped by the next', async ({ admin }) => {
    await installed(admin)
    await sql`insert into dataset_snapshot (row_id, dataset, state, built_at) values ('00000000-0000-0000-0000-000000000001', ${LINES}, 'building', now())`
    await sql.unsafe(`create table featherbase_copy.l_00000000000000000000000000000001 (like featherbase_copy.copyproof__forecast_line_day)`)
    expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    expect((await sql`select state, error from dataset_snapshot where row_id = '00000000-0000-0000-0000-000000000001'`)[0])
      .toEqual({ state: 'failed', error: 'interrupted: the server stopped during the load' })
    expect(await parts()).toBe(1)
  })

  test('waits while its app is off, and is refused a source that cannot load it', async ({ admin }) => {
    await installed(admin)
    await admin.post('/api/set_app_enabled', { name: APP, enabled: false })
    expect(await load(LINES)).toEqual({ status: 'not_due', reason: 'the app copyproof is off or mid-upgrade' })
    await admin.post('/api/set_app_enabled', { name: APP, enabled: true })
    const source = await admin.get<{ updated_at: string }>('/api/table/Data%20Source/copyproof-warehouse')
    await admin.post('/api/save_row', { table: 'Data Source', row: { row_id: 'copyproof-warehouse', updated_at: source.updated_at, engine: 'csv-folder', root_path: '/tmp', url_env: null } })
    invalidateSources()
    await expect(load(LINES)).rejects.toThrow('Data source copyproof-warehouse (csv-folder) cannot load a read-only copy')
    await expect(checkCopy('copyproof.nothing')).rejects.toThrow('copyproof.nothing is not a read-only copy any installed app declares')
    await sql`delete from featherbase.table_copy where target_table = ${LINES}`
    await expect(load(LINES)).rejects.toThrow(`${LINES} is not a read-only copy`)
  })

  test('without a run check or a daily time loads on every check', async ({ admin }) => {
    await installed(admin, [lines({ runKey: undefined, query: `select * from ${warehouse.schema}.forecast_line_day` })])
    expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    expect(await load(LINES)).toMatchObject({ status: 'loaded' })
  })

  test('keeps the active load and the one before; older ones go whole', async ({ admin }) => {
    await installed(admin, [lines({ runKey: undefined, query: `select * from ${warehouse.schema}.forecast_line_day` })])
    for (let i = 0; i < 4; i++) await load(LINES)
    expect(await loads()).toEqual(['superseded', 'active'])
    expect(await parts()).toBe(2)
    // An old load something else still reads stays until the next load.
    const [old] = await sql`select row_id from dataset_snapshot where dataset = ${LINES} and state = 'superseded'`
    await sql.unsafe(`create view featherbase_copy.holds_old as select * from featherbase_copy.l_${String(old.row_id).replaceAll('-', '')}`)
    await load(LINES)
    expect(await loads()).toEqual(['superseded', 'superseded', 'active'])
  })
})

describe('asking for a load', () => {
  test('says what it loaded, or why it loaded nothing, and records who asked', async ({ admin }) => {
    await installed(admin)
    const first = await requestAndRun(admin, LINES)
    expect(first.execution.result).toMatch(/^Loaded 1 rows as load [0-9a-f-]{36}$/)
    expect((await sql`select triggered_by from dataset_snapshot where dataset = ${LINES} and state = 'active'`)[0].triggered_by).toBe(admin.user)
    expect(await loadState(admin, LINES)).toMatchObject({ app: APP, app_title: 'Copy proof', source: 'copyproof-warehouse', can_open_source: true,
      run_check: true, run: { run_id: 'Dec-1' }, rows: 1, failed: null, pending: null })
  })

  test('needs a copy named, and is one load at a time', async ({ admin }) => {
    await installed(admin)
    await expectRefused(admin.post('/api/copy_load', {}), 417)
    expect((await admin.fetch('/api/copy_load', { method: 'POST', body: 'not json' })).status).toBe(417)
    await expectRefused(admin.post('/api/copy_load', { table: `${APP}.note` }), 404)
    expect(await admin.post('/api/copy_load', { table: LINES })).toEqual({ queued: true, message: 'The check for a new run has started' })
    expect(await admin.post('/api/copy_load', { table: LINES, force: true })).toEqual({ queued: false, message: 'A load is already waiting to run' })
    await sql`update background_job set job_status = 'running' where method = ${LOAD_JOB}`
    // A load that runs holds the copy's lock (here, on a connection of its own).
    const held = await _getRootSql().reserve()
    try {
      await held`begin`
      await held`select pg_advisory_xact_lock(hashtext('read-only-copy:' || ${LINES}))`
      expect(await admin.post('/api/copy_load', { table: LINES })).toEqual({ queued: false, message: 'A load is running now' })
      expect(await loadState(admin, LINES)).toMatchObject({ pending: 'running', loaded_at: null, rows: null, run: null })
    } finally { await held`rollback`; held.release() }
    // Without it, the load is over (the server stopped during it): it ends as failed and a new one starts.
    expect(await admin.post('/api/copy_load', { table: LINES })).toEqual({ queued: true, message: 'The check for a new run has started' })
    expect(await sql`select job_status, error from background_job where method = ${LOAD_JOB} order by created_at`).toEqual([
      { job_status: 'failed', error: 'interrupted: the server stopped during the load' }, { job_status: 'queued', error: null }])
    expect(await loadState(admin, `${APP}.note`)).toBeNull()
  })

  test('a load job that names no declared copy does nothing', async () => {
    await sql`insert into background_job (row_id, method, payload, job_status, run_at, max_attempts)
      values ('forged-load', ${LOAD_JOB}, ${sql.json({ table: 'copyproof.nothing' })}, 'queued', now(), 1)`
    expect(await runOneJob()).toBe(true)
    expect((await sql`select error from job_execution where method = ${LOAD_JOB} order by started_at desc limit 1`)[0].error)
      .toContain('copyproof.nothing is not a read-only copy any installed app declares')
  })
})

describe('after a new load', () => {
  test('the first load tells the job of no previous one, and nothing moved', async ({ admin }) => {
    await installed(admin, [lines({ onNewLoad: 'carry_changes' })])
    const { snapshot } = await load(LINES)
    await sql`delete from background_job where job_status = 'queued' and not (payload ? 'new_load')`
    await sql`update background_job set run_at = now() where job_status = 'queued'`
    jobCalls().length = 0
    expect(await runOneJob()).toBe(true)
    expect(jobCalls()).toEqual([{ load: { dataset: 'forecast_line_day', previous: null, current: snapshot }, moves: [] }])
  })

  test('a run that names a load the platform did not make never runs the job', async ({ admin }) => {
    await installed(admin, [lines({ onNewLoad: 'carry_changes' })])
    await load(LINES)
    await sql`delete from background_job where job_status = 'queued'`
    await sql`insert into background_job (row_id, method, payload, job_status, run_at, max_attempts)
      values ('forged', 'copyproof.carry_changes', ${sql.json({ new_load: { dataset: 'forecast_line_day', previous: null, current: 'not-a-load' } })}, 'queued', now(), 1)`
    jobCalls().length = 0
    expect(await runOneJob()).toBe(true)
    expect(jobCalls()).toEqual([])
    expect((await sql`select error from job_execution where method = 'copyproof.carry_changes' order by started_at desc limit 1`)[0].error)
      .toContain('was queued for a new load it was not told of')
  })

  test('moves groups by key-like columns, sums a number column, and takes a share', async ({ admin }) => {
    await installed(admin, [lines()], [LKS, RVR])
    const first = (await load(LINES)).snapshot!
    await warehouse.publish('Dec-2', [dec2(LKS, '1050.00'), ['Dec-2', 'NEW', 'GJ01', '2026-12-01', '10.00']])
    const second = (await load(LINES)).snapshot!
    const by = ['store_code']
    expect(await loadMoves(LINES, first, second, { by, measure: 'value', threshold: 4 })).toEqual([
      { group: { store_code: 'LKS' }, before: '1000.00', after: '1050.00' },
      { group: { store_code: 'NEW' }, before: null, after: '10.00' },
      { group: { store_code: 'RVR' }, before: '800.00', after: null },
    ])
    expect(await loadMoves(LINES, first, second, { by, measure: 'value' })).toHaveLength(2)
    await expect(loadMoves('copyproof.nothing', first, second, { by, measure: 'value' })).rejects.toThrow('not a read-only copy')
    await expect(loadMoves(LINES, first, second, { by: ['value'], measure: 'value' })).rejects.toThrow("moves groups by the copy's text, integer or date columns")
    await expect(loadMoves(LINES, first, second, { by, measure: 'store_code' })).rejects.toThrow("moves sums one of the copy's number columns, not store_code")
    await expect(loadMoves(LINES, first, second, { by, measure: 'value', threshold: -1 })).rejects.toThrow('A moves threshold is a percentage, 0 or more')
    await expect(loadMoves(LINES, first, 'not-a-load', { by, measure: 'value' })).rejects.toThrow(`Those are not two loads ${LINES} keeps`)
  })
})

describe('reading a copy', () => {
  const asApp = (client: Parameters<typeof install>[0], path: string, body: unknown) => client.fetch(path, { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': `${APP}@1.0.0` } })

  test('the app’s own code reads its copy, the current load, and never writes it', async ({ admin }) => {
    await installed(admin, [lines()], [LKS, RVR])
    await load(LINES)
    const read = await asApp(admin, `/api/app_reads/${APP}/lines_as_rows`, { payload: {} })
    expect(await read.json()).toEqual({ result: [{ row_id: 'LKS·GJ01·2026-12-01', run_id: 'Dec-1', value: '1000.00' }] })
    // A validator checks a note against the copy.
    await expectRefused(admin.post('/api/save_row', { table: `${APP}.note`, row: { row_id: 'n1', body: 'NOPE·GJ01·2026-12-01' } }), 417, 'No forecast line NOPE·GJ01·2026-12-01 in the current run')
    expect(await admin.post('/api/save_row', { table: `${APP}.note`, row: { row_id: 'n2', body: 'RVR·GJ01·2026-12-01' } })).toMatchObject({ row_id: 'n2' })
    const write = await asApp(admin, `/api/app_actions/${APP}/rewrite`, { idempotencyKey: 'rewrite-1', payload: {} })
    expect(write.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(await write.json())).toContain(`Action has not declared Table ${LINES}`)
    expect((await rows(LINES)).map((r) => r.value)).toEqual(['1000.00', '800.00'])
  })

  test('before its first load answers nothing yet', async ({ admin, createUser }) => {
    await installed(admin)
    expect(await readLines(await createUser({ roles: ['Copy Reader'] }), ['LKS'])).toEqual({ status: 200, body: { result: null } })
    expect(SALES).toBe('copyproof.sales_day')
  })
})

describe('a copy from DuckDB', () => {
  let dir: string
  beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir); overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
  afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); overrideVariable('MOTHERDUCK_TOKEN', undefined); rmSync(dir, { recursive: true, force: true }) })

  test('describes and streams with the run check’s values, decimals exact', async ({ admin }) => {
    await changeStandin(dir, 'sales', [
      `create table fb_forecast_run as select 'Dec-1' as run_id, 'official' as status`,
      `create table fb_forecast_line_day (run_id varchar, store_code varchar, subcategory_code varchar, sale_date date, value decimal(20,2))`,
      `insert into fb_forecast_line_day values ('Dec-1', 'LKS', 'GJ01', '2026-12-01', 1234567890123.45), ('Dec-0', 'LKS', 'GJ01', '2026-12-01', 1)`,
    ])
    const md = lines({ source: 'copyproof-md', query: 'select * from sales.main.fb_forecast_line_day where run_id = {run_id}',
      runKey: "select run_id from sales.main.fb_forecast_run where status = 'official'", guard: [{ kind: 'source_total', column: 'value' }] })
    await install(admin, await writeApp([md]))
    await admin.post('/api/table/Data%20Source:motherduck_connect', { name: 'copyproof-md', databases: ['sales'] })
    expect(await load(LINES)).toMatchObject({ status: 'loaded', rows: 1 })
    expect(await rows(LINES)).toMatchObject([{ row_id: 'LKS·GJ01·2026-12-01', value: '1234567890123.45' }])
    await changeStandin(dir, 'sales', ['alter table fb_forecast_line_day rename column value to forecast_value'])
    invalidateSources()
    expect(await load(LINES, { force: true })).toMatchObject({ status: 'refused', reason: expect.stringContaining('the source has no column value (renamed or removed?)') })
    await changeStandin(dir, 'sales', ['drop table fb_forecast_line_day'])
    invalidateSources()
    await expect(load(LINES, { force: true })).rejects.toThrow(/fb_forecast_line_day does not exist/)
  })

  test('says what family each DuckDB type is', () => {
    expect(['DECIMAL(18,2)', 'DOUBLE', 'BIGINT', 'VARCHAR', 'DATE', 'TIMESTAMP WITH TIME ZONE', 'BOOLEAN', 'BLOB'].map(duckFamily))
      .toEqual(['decimal', 'float', 'integer', 'text', 'date', 'timestamp', 'boolean', 'other'])
  })
})
