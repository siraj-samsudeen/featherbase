// read-only-copies' fenced scenarios (#1418), on a made-up warehouse in the
// sibling test database and the `copyproof` app written per test
// (test/read-only-copy-app.ts). One example runs through every scenario: the
// forecast lines of store LKS, subcategory GJ01, on 1 December, run "Dec-1"
// replaced by run "Dec-2". A check runs as the copy's schedule runs it, or
// through the worker where the schedule itself is the point.
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../../src/db'
import { runOneJob } from '../../src/jobs'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import {
  APP, LINES, Warehouse, forecastLines, install, jobCalls, load, loadState, readLines, removeFolders, requestAndRun, rows, upgrade, writeApp,
  type Line,
} from '../read-only-copy-app'
import type { LoadOutcome } from '../../src/read-only-copy'

const scenario = scenarioFor(test, 'read-only-copies')
const warehouse = new Warehouse('b4_copy_scenarios')
beforeAll(() => warehouse.create())
afterAll(() => warehouse.drop())
afterEach(removeFolders)

const LKS_GJ01: Line = ['Dec-1', 'LKS', 'GJ01', '2026-12-01', '1000.00']
const RVR_GJ01: Line = ['Dec-1', 'RVR', 'GJ01', '2026-12-01', '800.00']
const run2 = (line: Line, value = line[4]): Line => ['Dec-2', line[1], line[2], line[3], value]
const runs = async () => [...new Set((await rows(LINES)).map((r) => r.run_id))]

/** The forecast lines copy, installed, holding run Dec-1 (`lines`). */
async function holdingDec1(admin: TestClient, lines: Line[] = [LKS_GJ01], more: Record<string, unknown> = {}) {
  const dir = await writeApp([forecastLines(warehouse.schema, more)])
  await install(admin, dir)
  await warehouse.publish('Dec-1', lines)
  expect(await load(LINES)).toMatchObject({ status: 'loaded' })
  return dir
}

describe('read-only-copies', () => {
  scenario('The forecast lines arrive with exact figures', async ({ admin }, step) => {
    let dir!: string
    await step('an app declares forecast lines by store, subcategory and day', async () => { dir = await writeApp([forecastLines(warehouse.schema)]) })
    await step('the warehouse\'s run "Dec-1" holds 1234567890123.45 for store "LKS", subcategory "GJ01" on 1 December',
      () => warehouse.publish('Dec-1', [['Dec-1', 'LKS', 'GJ01', '2026-12-01', '1234567890123.45']]))
    await step('the app is installed and its copy is loaded', async () => {
      await install(admin, dir)
      expect(await load(LINES)).toMatchObject({ status: 'loaded', rows: 1 })
    })
    await step('the forecast lines show 1234567890123.45 for store "LKS", subcategory "GJ01" on 1 December', async () => {
      const line = await admin.get(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`)
      expect(line).toMatchObject({ run_id: 'Dec-1', store_code: 'LKS', subcategory_code: 'GJ01', value: '1234567890123.45' })
    })
  })

  scenario('A load whose rows repeat a key is refused', async ({ admin }, step) => {
    let outcome!: LoadOutcome
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin))
    await step('the warehouse\'s run "Dec-2" has two rows for store "LKS", subcategory "GJ01" on 1 December',
      () => warehouse.publish('Dec-2', [run2(LKS_GJ01), run2(LKS_GJ01, '5.00')]))
    await step('the copy is loaded', async () => { outcome = await load(LINES) })
    await step('the load is refused, naming the repeated row', () => {
      expect(outcome).toMatchObject({ status: 'refused', reason: 'forecast_line_day: 2 rows have the key LKS·GJ01·2026-12-01; each store_code × subcategory_code × sale_date is one row' })
    })
    await step('the forecast lines still show run "Dec-1"', async () => expect(await runs()).toEqual(['Dec-1']))
  })

  scenario('The user cannot correct a forecast line', async ({ admin }, step) => {
    let line!: { updated_at: string }
    await step('the forecast lines copy holds run "Dec-1"', async () => {
      await holdingDec1(admin)
      line = await admin.get(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`)
    })
    await step('the user tries to change the figure for store "LKS", subcategory "GJ01" on 1 December', () =>
      expectRefused(admin.post('/api/save_row', { table: LINES, row: { row_id: 'LKS·GJ01·2026-12-01', updated_at: line.updated_at, value: '1.00' } }), 403))
    await step('the change is refused', async () => {
      expect((await rows(LINES))[0]).toMatchObject({ value: '1000.00' })
      await expectRefused(admin.post('/api/save_row', { table: LINES, row: { row_id: 'NEW', store_code: 'NEW' } }), 403)
    })
  })

  scenario('A load that loses a store keeps the last good run', async ({ admin }, step) => {
    let outcome!: LoadOutcome
    await step('the forecast lines copy holds run "Dec-1" for stores "LKS" and "RVR"', () => holdingDec1(admin, [LKS_GJ01, RVR_GJ01],
      { guard: [{ kind: 'keeps_values', column: 'store_code' }] }))
    await step('the app declares that no store may go missing', async () => {
      expect((await import('../../src/read-only-copy')).declaredCopy(LINES)?.dataset.guard).toEqual([{ kind: 'keeps_values', column: 'store_code' }])
    })
    await step('the warehouse\'s run "Dec-2", which has no rows for store "RVR", is loaded', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01)])
      outcome = await load(LINES)
    })
    await step('the load is refused, naming store "RVR"', () =>
      expect(outcome).toMatchObject({ status: 'refused', reason: 'forecast_line_day: store_code RVR is missing from the new load' }))
    await step('the forecast lines still show run "Dec-1"', async () => expect(await runs()).toEqual(['Dec-1']))
  })

  scenario('A load that passes its checks replaces the copy', async ({ admin }, step) => {
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin, [LKS_GJ01], {
      guard: [{ kind: 'source_total', column: 'value' }, { kind: 'keeps_values', column: 'store_code' }, { kind: 'min_rows', value: 1 }] }))
    await step('the warehouse\'s run "Dec-2" is loaded and passes its checks', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01, '1120.00')])
      expect(await load(LINES)).toMatchObject({ status: 'loaded', rows: 1 })
    })
    await step('the forecast lines show only run "Dec-2"', async () => {
      expect(await rows(LINES)).toMatchObject([{ run_id: 'Dec-2', value: '1120.00' }])
    })
  })

  scenario('A column added in the warehouse changes nothing', async ({ admin }, step) => {
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin, [LKS_GJ01], {
      query: `select * from ${warehouse.schema}.forecast_line_day where run_id = {run_id}` }))
    await step('the warehouse\'s feed gains a column the app has not declared',
      () => warehouse.alter('alter table {schema}.forecast_line_day add column promo_flag boolean default true'))
    await step('the warehouse\'s run "Dec-2" is loaded', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01)])
      expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    })
    await step('the forecast lines show run "Dec-2" without the new column', async () => {
      const [line] = await rows(LINES)
      expect(line).toMatchObject({ run_id: 'Dec-2' })
      expect(line).not.toHaveProperty('promo_flag')
    })
    await warehouse.alter('alter table {schema}.forecast_line_day drop column promo_flag')
  })

  scenario('A renamed column stops the load and says why', async ({ admin }, step) => {
    let run!: Awaited<ReturnType<typeof requestAndRun>>
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin))
    await step('the warehouse renames the feed\'s value column without keeping the old name',
      () => warehouse.alter('alter table {schema}.forecast_line_day rename column value to forecast_value'))
    try {
      await step('the warehouse\'s run "Dec-2" is loaded', async () => {
        await warehouse.publish('Dec-2', [run2(LKS_GJ01)])
        run = await requestAndRun(admin, LINES)
      })
    } finally {
      await warehouse.alter('alter table {schema}.forecast_line_day rename column forecast_value to value')
    }
    await step('the load is refused, naming the missing value column', () => {
      expect(run.execution).toMatchObject({ outcome: 'refused' })
      expect(String(run.execution.error ?? run.execution.result)).toContain('the source has no column value (renamed or removed?)')
    })
    await step('the forecast lines still show run "Dec-1"', async () => expect(await runs()).toEqual(['Dec-1']))
    await step('the copy shows why its last load failed', async () => {
      expect(await loadState(admin, LINES)).toMatchObject({ run: { run_id: 'Dec-1' }, pending: null,
        failed: { reason: 'the source has no column value (renamed or removed?). The last good load is kept' } })
    })
  })

  scenario('A column the app adds is filled by the next load', async ({ admin }, step) => {
    let installed!: string
    const withQuantity = (schema: string) => forecastLines(schema, {
      query: `select run_id, store_code, subcategory_code, sale_date, value, qty from ${schema}.forecast_line_day where run_id = {run_id}`,
      columns: [...(forecastLines(schema).columns as unknown[]), { name: 'qty', type: 'integer' }],
    })
    await step('the forecast lines copy holds run "Dec-1"', async () => { installed = await holdingDec1(admin) })
    await step('the app is upgraded to declare the feed\'s quantity column', async () => {
      await upgrade(admin, installed, await writeApp([withQuantity(warehouse.schema)], '1.1.0'), '1.1.0')
      expect((await rows(LINES))[0]).toMatchObject({ run_id: 'Dec-1', qty: null })
    })
    await step('the warehouse\'s run "Dec-2" is loaded', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01)])
      expect(await load(LINES)).toMatchObject({ status: 'loaded' })
    })
    await step('the forecast lines show the quantity for store "LKS", subcategory "GJ01" on 1 December', async () => {
      expect(await rows(LINES)).toMatchObject([{ row_id: 'LKS·GJ01·2026-12-01', run_id: 'Dec-2', qty: 7 }])
    })
  })

  scenario('An unchanged run loads nothing', async ({ admin }, step) => {
    let run!: Awaited<ReturnType<typeof requestAndRun>>
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin))
    await step('the warehouse still names run "Dec-1" as the official run', async () => {
      expect(await warehouse.db.unsafe(`select run_id from ${warehouse.schema}.forecast_run where status = 'official'`)).toEqual([{ run_id: 'Dec-1' }])
    })
    await step('the user checks for a new run', async () => { run = await requestAndRun(admin, LINES) })
    await step('nothing is loaded and the copy says the run is unchanged', async () => {
      expect(run.asked).toEqual({ queued: true, message: 'The check for a new run has started' })
      expect(run.execution).toMatchObject({ outcome: 'success', result: 'Nothing loaded: the run is unchanged ({"run_id":"Dec-1"})' })
      expect(await sql`select count(*)::int as n from dataset_snapshot where dataset = ${LINES}`).toEqual([{ n: 1 }])
    })
  })

  scenario('Loading now reloads the same run', async ({ admin }, step) => {
    let before!: unknown
    await step('the forecast lines copy holds run "Dec-1"', async () => {
      await holdingDec1(admin)
      before = (await sql`select row_id from dataset_snapshot where dataset = ${LINES} and state = 'active'`)[0].row_id
    })
    await step('the warehouse still names run "Dec-1" as the official run', () => warehouse.publish('Dec-1', [LKS_GJ01]))
    await step('the user loads the copy now', async () => {
      expect((await requestAndRun(admin, LINES, true)).asked).toEqual({ queued: true, message: 'The copy is loading' })
    })
    await step('the forecast lines show run "Dec-1" from a new load', async () => {
      expect(await runs()).toEqual(['Dec-1'])
      expect((await sql`select row_id from dataset_snapshot where dataset = ${LINES} and state = 'active'`)[0].row_id).not.toBe(before)
    })
  })

  scenario('The warehouse\'s script loads the new run', async ({ admin, createUser }, step) => {
    let script!: TestClient
    await step('the forecast lines copy holds run "Dec-1"', async () => {
      await holdingDec1(admin)
      // The warehouse's service account holds the role the app lets load its copy, nothing more.
      script = await createUser({ roles: ['Forecast Loader'] })
    })
    await step('the warehouse now names run "Dec-2" as the official run', () => warehouse.publish('Dec-2', [run2(LKS_GJ01)]))
    await step('the warehouse\'s script asks for a check after its build', async () => {
      expect((await requestAndRun(script, LINES)).execution).toMatchObject({ outcome: 'success' })
    })
    await step('the forecast lines show run "Dec-2"', async () => expect(await runs()).toEqual(['Dec-2']))
  })

  scenario('A reader cannot load the copy', async ({ admin, createUser, seed }, step) => {
    let reader!: TestClient
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin))
    await step('the user can read the forecast lines but may not load them', async () => {
      await seed('Role', { row_id: 'Forecast Viewer' })
      await seed('Permission', { ref_table: LINES, role: 'Forecast Viewer', operation: 'read' })
      reader = await createUser({ roles: ['Forecast Viewer'] })
      expect(await reader.get(`/api/table/${encodeURIComponent(LINES)}/${encodeURIComponent('LKS·GJ01·2026-12-01')}`)).toMatchObject({ run_id: 'Dec-1' })
    })
    await step('the user asks to load the copy', () =>
      expectRefused(reader.post('/api/copy_load', { table: LINES, force: true }), 403, `Not permitted to load ${LINES}`))
    await step('the request is refused and nothing is loaded', async () => {
      expect(await sql`select 1 from background_job where method = 'read_only_copy_load'`).toEqual([])
      expect(await loadState(reader, LINES)).toBeNull()
    })
  })

  scenario('A subcategory that moved 12% is reported', async ({ admin }, step) => {
    const GJ02: Line = ['Dec-1', 'LKS', 'GJ02', '2026-12-01', '500.00']
    let current!: string
    await step('the forecast lines copy holds run "Dec-1" with 1000 for store "LKS", subcategory "GJ01" and 500 for subcategory "GJ02"',
      () => holdingDec1(admin, [LKS_GJ01, GJ02], { onNewLoad: 'carry_changes' }))
    await step('run "Dec-2" replaces it with 1120 for "GJ01" and 520 for "GJ02"', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01, '1120.00'), run2(GJ02, '520.00')])
      const outcome = await load(LINES)
      current = outcome.snapshot!
      // Only the run that follows this load: not the job's own daily run, nor the one after the first load.
      await sql`delete from background_job where job_status = 'queued'
        and (method <> 'copyproof.carry_changes' or payload->'new_load'->>'current' is distinct from ${current})`
      await sql`update background_job set run_at = now() where job_status = 'queued'`
      jobCalls().length = 0
      expect(await runOneJob()).toBe(true)
    })
    await step('the app is told that "GJ01" moved from 1000 to 1120', () => {
      const [call] = jobCalls().filter((c) => c.load)
      expect(call.load).toMatchObject({ dataset: 'forecast_line_day', current })
      expect(call.moves).toEqual([{ group: { store_code: 'LKS', subcategory_code: 'GJ01' }, before: '1000.00', after: '1120.00' }])
    })
    await step('it is not told about "GJ02", which moved 4%', () =>
      expect(JSON.stringify(jobCalls())).not.toContain('GJ02'))
  })

  scenario('The team leader hears that her line moved', async ({ admin, createUser }, step) => {
    let lead!: TestClient
    await step('the forecast lines copy holds run "Dec-1" with 1000 for store "LKS", subcategory "GJ01"',
      () => holdingDec1(admin, [LKS_GJ01], { onNewLoad: 'carry_changes' }))
    await step('the app tells the team leader of each subcategory that moves', async () => {
      lead = await createUser({ email: 'team.leader@example.test', roles: [] })
      ;(globalThis as { __copyproofLead?: string }).__copyproofLead = lead.user!
    })
    await step('run "Dec-2" replaces it with 1120 for "GJ01"', async () => {
      await warehouse.publish('Dec-2', [run2(LKS_GJ01, '1120.00')])
      const { snapshot } = await load(LINES)
      await sql`delete from background_job where job_status = 'queued'
        and (method <> 'copyproof.carry_changes' or payload->'new_load'->>'current' is distinct from ${snapshot!})`
      await sql`update background_job set run_at = now() where job_status = 'queued'`
      expect(await runOneJob()).toBe(true)
    })
    await step('the team leader has a notice that "GJ01" moved from 1000 to 1120', async () => {
      expect(await sql`select subject, read from notification_log where for_user = ${lead.user!}`).toEqual([{ subject: 'GJ01 moved: 1000.00 to 1120.00', read: false }])
    })
  })

  scenario('A team leader sees only her store\'s lines', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    let answer!: { status: number; body: unknown }
    await step('the forecast lines copy holds run "Dec-1" for stores "LKS" and "RVR"', () => holdingDec1(admin, [LKS_GJ01, RVR_GJ01]))
    await step('the user covers store "LKS"', async () => {
      reader = await createUser({ email: 'team.leader@example.test', roles: ['Copy Reader'] })
    })
    await step('the app reads the forecast lines for the user', async () => { answer = await readLines(reader, ['LKS']) })
    await step('the user gets the lines of store "LKS" only', () => expect(answer).toMatchObject({ status: 200, body: { result: {
      dataset: 'forecast_line_day', served: 'cached',
      rows: [{ run_id: 'Dec-1', store_code: 'LKS', subcategory_code: 'GJ01', sale_date: '2026-12-01', value: 1000 }],
    } } }))
  })

  scenario('The forecast lines are not offered to the capture', async ({ admin }, step) => {
    let offered!: string[]
    await step('the forecast lines copy holds run "Dec-1"', () => holdingDec1(admin))
    await step('the capture lists the tables it may send to the warehouse', async () => {
      // The warehouse adapter's own rule: a user-created Table, bound to no
      // source, whose storage is an ordinary table.
      offered = (await sql`select t.name from table_def t join pg_tables p
        on p.schemaname = coalesce(t.physical_schema, 'featherbase') and p.tablename = coalesce(t.physical_relation, t.name)
        where t.data_source is null and not t."system"`).map((r) => String(r.name))
    })
    await step('the forecast lines are not among them', () => {
      expect(offered).toContain(`${APP}.note`)
      expect(offered).not.toContain(LINES)
      expect(offered.some((name) => name.includes('forecast_line_day'))).toBe(false)
    })
  })
})

