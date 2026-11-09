// background-and-scheduled-jobs' fenced scenarios that the server alone proves
// (#1070): a copied Plants table kept fresh by its hourly refresh, against the
// local MotherDuck stand-in. Each test is one fenced scenario of
// openspec/specs/background-and-scheduled-jobs/spec.md, step by step; the
// schedule a System Manager sets on screen is in apps/web/test/scenarios/.
//
// A restarted server has to recover the refresh's handler from the database.
// Here the run re-registers
// the saved schedules the way the server does when it starts
// (registerCopyRefreshJobs) and the worker runs the due job in-process.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { TestClient } from 'feather-testing-postgres'
import { overrideVariable } from '../../src/env'
import { invalidateSources } from '../../src/sources/registry'
import { sql } from '../../src/db'
import { runOneJob } from '../../src/jobs'
import { registerCopyRefreshJobs } from '../../src/copy-refresh'
import { buildStandin, changeStandin, STANDIN_TOKENS } from '../motherduck-standin'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'background-and-scheduled-jobs')

let dir: string
beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

type Row = Record<string, unknown> & { title?: string; updated_at?: string; deleted_at_source?: boolean }
type Execution = { outcome: string; result: string | null }
type Schedule = { row_id: string; method: string; cadence: string; enabled: boolean }

/** The copied Plants table: P01 Rose and P02 Fern, copied from its own stand-in relation. */
class Plants {
  source = `refresh-${randomUUID().slice(0, 8)}`
  relation = `plants_${randomUUID().replaceAll('-', '')}`
  job: Schedule | null = null
  execution: Execution | null = null
  importsBefore = 0
  conflictsBefore = 0

  constructor(readonly admin: TestClient) {}

  async create() {
    await changeStandin(dir, 'sales', [
      `create table ${this.relation} (code varchar, name varchar)`,
      `insert into ${this.relation} values ('P01', 'Rose'), ('P02', 'Fern')`,
    ])
    await this.admin.post('/api/table/Data%20Source:motherduck_connect', { name: this.source, databases: ['sales'] })
    await this.admin.post(`/api/table/Data%20Source/${encodeURIComponent(this.source)}:copy_create`, {
      database: 'sales', schema: 'main', table: this.relation, name: 'Plants', key: 'code',
      columns: [{ source: 'code', column_name: 'code' }, { source: 'name', column_name: 'title' }],
    })
    return this
  }

  row = (id: string) => this.admin.get<Row>(`/api/table/Plants/${id}`)

  async schedule(cadence = 'hourly') {
    this.job = await this.admin.post<Schedule>('/api/table/Plants:set_copy_schedule', { cadence, enabled: true })
    return this.job
  }

  scheduleInfo = () => this.admin.get<Schedule | null>('/api/table/Plants:copy_schedule')

  async change(statements: string[]) {
    await changeStandin(dir, 'sales', statements.map((s) => s.replaceAll('$plants', this.relation)))
    // Refresh also discards the stand-in's per-session source snapshot.
    await this.admin.post(`/api/table/Data%20Source/${encodeURIComponent(this.source)}:refresh_tables`, { database: 'sales' })
  }

  async correct() {
    const row = await this.row('P01')
    await this.admin.post('/api/save_row', { table: 'Plants', row: { ...row, title: 'Personal rose' } })
  }

  async invalidCandidates() {
    const meta = await this.admin.get<{ columns: Record<string, unknown>[] }>('/api/table/Plants:meta')
    await this.admin.put('/api/table_def/Plants', {
      columns: meta.columns.map((c) => ({ ...c, ...(c.column_name === 'title' ? { reqd: true } : {}) })),
    })
    await this.change(["update $plants set name = case when code = 'P01' then 'Valid change' else null end"])
    this.importsBefore = await importLogs()
    this.conflictsBefore = await conflictCount()
  }

  /** The due hourly refresh, run once by the worker after the schedules are registered as at server start. */
  async run() {
    const job = this.job ?? (await this.schedule())
    await registerCopyRefreshJobs()
    await sql`delete from background_job where method <> ${job.method} and job_status = 'queued'`
    await sql`update background_job set run_at = now(), max_attempts = 1 where method = ${job.method} and job_status = 'queued'`
    expect(await runOneJob(), 'the worker ran the due Plants refresh').toBe(true)
    const [execution] = await sql<Execution[]>`select outcome, result from job_execution where method = ${job.method} order by started_at desc limit 1`
    expect(execution, 'the worker executed the due Plants refresh').toBeDefined()
    this.execution = execution!
  }

  conflicts = () => this.admin.get('/api/table/Plants:import-conflicts')

  async assertSystemBatch() {
    expect(this.execution?.outcome).toBe('success')
    const info = await this.admin.get<{ last_run_id: string }>('/api/table/Plants:copy_info')
    const logs = await sql`select batch_id, created_by from import_log where ref_table = 'Plants' and batch_id = ${info.last_run_id}`
    expect(logs.length, 'the scheduled run has an ordinary undoable batch').toBeGreaterThan(0)
    expect(logs.every((l) => String(l.created_by).startsWith('copy-refresh:'))).toBe(true)
    const versions = await sql`select created_by from version where ref_table = 'Plants' and data->>'import_run' = ${info.last_run_id}`
    // A conflict-only run changes no stored values, so it needs no row version.
    expect(versions.every((v) => String(v.created_by).startsWith('copy-refresh:'))).toBe(true)
    await this.admin.post('/api/table/Plants:import-revert', { run_id: info.last_run_id })
  }
}

const importLogs = async () => (await sql`select count(*)::int as n from import_log where ref_table = 'Plants'`)[0]!.n as number
const conflictCount = async () => (await sql`select count(*)::int as n from featherbase.import_conflict where ref_table = 'Plants'`)[0]!.n as number

/** The responsible administrator: a System Manager who should hear of new conflicts. */
const RESPONSIBLE = 'responsible.administrator@example.test'

describe('background-and-scheduled-jobs', () => {
  scenario('A reader cannot schedule Plants', async ({ admin, createUser, seed }, step) => {
    let plants!: Plants
    let reader!: TestClient
    let refusal = 0
    await step('the user can read the copied Plants table but is not a System Manager', async () => {
      plants = await new Plants(admin).create()
      await seed('Role', { row_id: 'Plants Reader' })
      await seed('Permission', { ref_table: 'Plants', role: 'Plants Reader', operation: 'read' })
      reader = await createUser({ roles: ['Plants Reader'] })
      expect((await reader.get<{ data: unknown[] }>('/api/table/Plants')).data).toHaveLength(2)
    })
    await step('the user tries to schedule Plants to refresh hourly', async () => {
      refusal = (await reader.fetch('/api/table/Plants:set_copy_schedule', {
        method: 'POST', body: JSON.stringify({ cadence: 'hourly', enabled: true }),
      })).status
    })
    await step('the request is refused and Plants has no new schedule', async () => {
      expect(refusal).toBe(403)
      expect(await plants.scheduleInfo()).toBeNull()
    })
  })

  scenario('A correction survives an automatic copy', async ({ admin, createUser }, step) => {
    let plants!: Plants
    await step('the user corrected plant P01 in the copied Plants table', async () => {
      plants = await new Plants(admin).create()
      await createUser({ email: RESPONSIBLE, roles: ['System Manager'] })
      await plants.correct()
    })
    await step('the source now disagrees with that correction', () =>
      plants.change(["update $plants set name = 'Warehouse rose' where code = 'P01'"]))
    await step('the hourly Plants refresh runs', () => plants.run())
    await step('the correction is kept and the disagreement is recorded', async () => {
      expect((await plants.row('P01')).title).toBe('Personal rose')
      expect(JSON.stringify(await plants.conflicts())).toMatch(/Warehouse rose/)
    })
    await step('the run is one undoable system-attributed batch', () => plants.assertSystemBatch())
  })

  scenario('The next copy finds no changes', async ({ admin }, step) => {
    let plants!: Plants
    await step('the copied Plants table and its source both contain the same two plants', async () => {
      plants = await new Plants(admin).create()
    })
    await step('the hourly Plants refresh runs', () => plants.run())
    await step('the execution reports two unchanged rows and no changed rows', () => {
      expect(plants.execution!.outcome).toBe('success')
      expect(plants.execution!.result).toMatch(/2 unchanged/)
      expect(plants.execution!.result).toMatch(/0 changed/)
    })
  })

  scenario('A new disagreement reaches an administrator', async ({ admin, createUser }, step) => {
    let plants!: Plants
    await step('the user corrected plant P01 in the copied Plants table', async () => {
      plants = await new Plants(admin).create()
      await createUser({ email: RESPONSIBLE, roles: ['System Manager'] })
      await plants.correct()
    })
    await step('the source now disagrees with that correction', () =>
      plants.change(["update $plants set name = 'Warehouse rose' where code = 'P01'"]))
    await step('the hourly Plants refresh runs', () => plants.run())
    await step('the responsible administrators receive a notice naming Plants and its new conflict count', async () => {
      const notices = await sql<{ subject: string; body: string }[]>`select subject, body from email_queue
        where subject = 'Copy refresh conflicts: Plants' and recipient = ${RESPONSIBLE}`
      expect(notices.length).toBeGreaterThan(0)
      expect(notices.some((n) => n.body.includes('1 new conflict'))).toBe(true)
      expect(notices.every((n) => !n.body.includes('Warehouse rose') && !n.body.includes('Personal rose'))).toBe(true)
    })
  })

  scenario('A later plant fails validation', async ({ admin }, step) => {
    let plants!: Plants
    await step('the copied Plants source has a valid changed plant P01 followed by an invalid plant P02', async () => {
      plants = await new Plants(admin).create()
      await plants.invalidCandidates()
    })
    await step('the hourly Plants refresh runs', () => plants.run())
    await step('the execution fails and Plants still has its previous values', async () => {
      expect(plants.execution!.outcome).toBe('error')
      expect((await plants.row('P01')).title).toBe('Rose')
      expect((await plants.row('P02')).title).toBe('Fern')
    })
    await step('no batch or conflict from that failed run is retained', async () => {
      expect(await importLogs()).toBe(plants.importsBefore)
      expect(await conflictCount()).toBe(plants.conflictsBefore)
    })
  })

  scenario('The source has no plants left', async ({ admin }, step) => {
    let plants!: Plants
    await step('the copied Plants table contains plant P01 and its source is now empty', async () => {
      plants = await new Plants(admin).create()
      await plants.change(['delete from $plants'])
    })
    await step('the hourly Plants refresh runs', () => plants.run())
    await step('plant P01 is marked deleted at source in an undoable system-attributed batch', async () => {
      expect((await plants.row('P01')).deleted_at_source).toBe(true)
      await plants.assertSystemBatch()
      expect((await plants.row('P01')).deleted_at_source).toBe(false)
    })
  })

  scenario('Plants is removed before its next refresh', async ({ admin }, step) => {
    let plants!: Plants
    await step('the copied Plants table has an hourly schedule', async () => {
      plants = await new Plants(admin).create()
      await plants.schedule()
    })
    await step('the user removes Plants', () => admin.delete('/api/table_def/Plants'))
    await step('its schedule and pending refresh are removed', async () => {
      const method = plants.job!.method
      expect(await sql`select row_id from scheduled_job where method = ${method}`).toHaveLength(0)
      expect(await sql`select row_id from background_job where method = ${method} and job_status = 'queued'`).toHaveLength(0)
    })
  })
})
