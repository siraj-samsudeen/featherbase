// #971: a copy reads its source without the app lifecycle lock and takes it
// only to apply, so a long read cannot make a deploy fail. These run on
// committed rows and real connections, so the database's locks decide.
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { committedTest as test } from './pg-test-shared'
import { sql } from '../src/db'
import { DEPLOY_LOCK_WAIT, instanceDeployOperation, type DeployLockWait } from '../src/app-lifecycle'
import { overrideVariable } from '../src/env'
import { invalidateMeta } from '../src/meta'
import { tableRelation } from '../src/table-engine'
import { registerController, unregisterController } from '../src/controllers'
import { invalidateSources } from '../src/sources/registry'
import { runOneJob } from '../src/jobs'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import type { TestClient } from 'feather-testing-postgres'
import { expectRefused } from './fixtures'

const gates = vi.hoisted(() => ({
  read: undefined as (() => Promise<void>) | undefined,
  apply: undefined as (() => Promise<void>) | undefined,
}))

vi.mock('../src/sources/duckdb-driver', async (original) => {
  const actual = await original<typeof import('../src/sources/duckdb-driver')>()
  return { ...actual, stream: async function* (...args: Parameters<typeof actual.stream>) {
    await gates.read?.()
    yield* actual.stream(...args)
  } }
})
vi.mock('../src/actions/collection-import', async (original) => {
  const actual = await original<typeof import('../src/actions/collection-import')>()
  return { ...actual, importRows: async (...args: Parameters<typeof actual.importRows>) => {
    await gates.apply?.()
    return actual.importRows(...args)
  } }
})

/** Stops the code at a gate until released; `reached` settles when it gets there. */
function stall() {
  let entered!: () => void
  let release!: () => void
  const reached = new Promise<void>((done) => { entered = done })
  const opened = new Promise<void>((done) => { release = done })
  return { reached, release, wait: async () => { entered(); await opened } }
}

const QUICK: DeployLockWait = { attemptSeconds: 0.2, pauseSeconds: 0.1, attempts: 1 }
/** A deploy that finds nobody holding the lifecycle lock goes through at once. */
const deployNow = () => instanceDeployOperation(async () => 'deployed', QUICK)

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir); overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); overrideVariable('MOTHERDUCK_TOKEN', undefined); rmSync(dir, { recursive: true, force: true }) })

const SOURCES = '/api/table/Data%20Source'
const AGAIN = '/api/table/Overlap%20Stores:copy_again'
const COLUMNS = [{ source: 'code', column_name: 'code' }, { source: 'name', column_name: 'title' }]

async function makeCopy(admin: TestClient) {
  await admin.post(`${SOURCES}:motherduck_connect`, { name: 'overlap', databases: ['sales'] })
  await admin.post(`${SOURCES}/overlap:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Overlap Stores', key: 'code', columns: COLUMNS })
}

describe('a copy and a deploy at the same time', () => {
  test('a deploy goes through while Copy again reads the warehouse', async ({ admin }) => {
    await makeCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post<{ unchanged: number }>(AGAIN, {})
      await read.reached
      await expect(deployNow()).resolves.toBe('deployed')
      read.release()
      expect((await copy).unchanged).toBe(3)
    } finally { gates.read = undefined; read.release() }
  })

  test('an encoded path gets no lifecycle lock either, so it keeps the same lock order', async ({ admin }) => {
    await makeCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post<{ unchanged: number }>('/api/table/Overlap%20Stores%3Acopy_again', {})
      await read.reached
      await expect(deployNow()).resolves.toBe('deployed')
      read.release()
      expect((await copy).unchanged).toBe(3)
    } finally { gates.read = undefined; read.release() }
  })

  test('a path that cannot be decoded is an ordinary request', async ({ admin }) => {
    await expect(admin.post('/api/table/%E0%A4%A:copy_again', {})).rejects.toMatchObject({ status: expect.any(Number) })
  })

  test('any other request still holds the lifecycle lock', async ({ admin }) => {
    await makeCopy(admin)
    // A row lock keeps the request open, so it is running when the deploy tries.
    let release!: () => void
    let locked!: () => void
    const holding = new Promise<void>((done) => { locked = done })
    const held = sql.begin(async (tx) => {
      await tx`select 1 from featherbase.table_def where name = 'Overlap Stores' for update`
      locked()
      await new Promise<void>((done) => { release = done })
    })
    await holding
    const other = admin.post('/api/table_def/Overlap%20Stores/rename_column', { from: 'title', to: 'heading' }).catch(() => {})
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      await expect(deployNow()).rejects.toThrow(/kept the apps busy/)
    } finally { release() }
    await held
    await other
  })

  test('a deploy goes through while a first copy reads the warehouse', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'overlap', databases: ['sales'] })
    const read = stall()
    gates.read = read.wait
    try {
      const made = admin.post<{ result: { inserted: number } }>(`${SOURCES}/overlap:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Overlap Stores', key: 'code', columns: COLUMNS })
      await read.reached
      await expect(deployNow()).resolves.toBe('deployed')
      read.release()
      expect((await made).result.inserted).toBe(3)
    } finally { gates.read = undefined; read.release() }
  })

  test('a deploy goes through while a scheduled refresh reads the warehouse', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Overlap%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    const read = stall()
    gates.read = read.wait
    try {
      const job = runOneJob()
      await read.reached
      await expect(deployNow()).resolves.toBe('deployed')
      read.release()
      await expect(job).resolves.toBe(true)
    } finally { gates.read = undefined; read.release() }
    const [run] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(run.outcome).toBe('success')
    expect(run.result).toContain('3 unchanged')
    // The recurrence still advances, though the run left the lock.
    expect(await sql`select 1 from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(1)
  })

  test('a failed scheduled read is recorded and retried like any failed job', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Overlap%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    gates.read = async () => { throw new Error('the warehouse went away') }
    try { await expect(runOneJob()).resolves.toBe(true) }
    finally { gates.read = undefined }
    const [run] = await sql`select outcome, error from job_execution where method = ${schedule.method}`
    expect(run).toMatchObject({ outcome: 'error', error: 'the warehouse went away' })
  })

  test('a long apply running, a deploy starting: the deploy tries again and succeeds after it ends', async ({ admin }) => {
    await makeCopy(admin)
    await changeStandin(dir, 'sales', ["update stores set name = 'Harbour Road North' where code = 'S001'"])
    invalidateSources('overlap')
    const applying = stall()
    gates.apply = applying.wait
    const lines: string[] = []
    const order: string[] = []
    try {
      const copy = admin.post(AGAIN, {}).then((done) => { order.push('copy'); return done })
      await applying.reached
      const deploy = instanceDeployOperation(async () => { order.push('deploy'); return 'deployed' }, { attemptSeconds: 0.2, pauseSeconds: 0.2, attempts: 25 }, (line) => {
        lines.push(line)
        // After two tries found the apps busy, the copy's long apply ends.
        if (/try 2 of/.test(line)) applying.release()
      })
      await expect(deploy).resolves.toBe('deployed')
      await copy
    } finally { gates.apply = undefined; applying.release() }
    expect(lines[0]).toMatch(/try 1 of 25: the live server is still busy \(1 live request or job/)
    expect(lines.at(-1)).toMatch(/lifecycle lock taken on try [3-9]/)
    expect(order[0]).toBe('copy')
    expect(await admin.get('/api/table/Overlap%20Stores/S001')).toMatchObject({ title: 'Harbour Road North' })
    await changeStandin(dir, 'sales', ["update stores set name = 'Harbour Road' where code = 'S001'"])
  })

  test('manual and scheduled refreshes of one table take turns across the read', async ({ admin }) => {
    await makeCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const first = admin.post(AGAIN, {})
      await read.reached
      gates.read = undefined
      const second = admin.post(AGAIN, {})
      // The second is held at the table's own lock, holding no lifecycle lock.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await expect(deployNow()).resolves.toBe('deployed')
      const [waiting] = await sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted
        and database = (select oid from pg_database where datname = current_database())`
      expect(waiting.n).toBe(1)
      read.release()
      await first
      await second
    } finally { gates.read = undefined; read.release() }
    expect(await sql`select 1 from import_log where ref_table = 'Overlap Stores'`).toHaveLength(3)
  })

  test('a value another writer is saving is not taken for unchanged', async ({ admin }) => {
    await makeCopy(admin)
    const relation = sql(await tableRelation('Overlap Stores'))
    let release!: () => void
    let wrote!: () => void
    const writing = new Promise<void>((done) => { wrote = done })
    const writer = sql.begin(async (tx) => {
      await tx`update ${relation} set title = 'Saved meanwhile' where row_id = 'S001'`
      wrote()
      await new Promise<void>((done) => { release = done })
    })
    await writing
    const copy = admin.post(AGAIN, {}).then(() => 'applied', () => 'refused')
    // The copy waits for the row, rather than deciding on the value before the save.
    for (let i = 0; i < 40; i++) {
      const [{ n }] = await sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%for update%' and datname = current_database()`
      if (n > 0) break
      await new Promise((done) => setTimeout(done, 25))
    }
    release()
    await writer
    await copy
    const [latest] = await sql`select values from featherbase.import_source where ref_table = 'Overlap Stores' and ref_name = 'S001' order by created_at desc, row_id desc limit 1`
    const [row] = await sql`select title from ${relation} where row_id = 'S001'`
    // Either the copy applied over the save, or it was refused and observed nothing.
    if (row.title === 'Saved meanwhile') expect(await sql`select count(*)::int as n from import_log where ref_table = 'Overlap Stores'`).toEqual([{ n: 1 }])
    else expect(latest.values).toMatchObject({ title: 'Harbour Road' })
  })

  test('a copy takes the locks a save takes before its rows, so it cannot deadlock with a save', async ({ admin }) => {
    await makeCopy(admin)
    await changeStandin(dir, 'sales', ["update stores set name = 'Harbour Road North' where code = 'S001'"])
    invalidateSources('overlap')
    const controller = { table: 'Overlap Stores', hooks: { before_lock: async ({ tx }: { tx: typeof sql }) => { await tx`select pg_advisory_xact_lock(971)` } } }
    registerController(controller as never)
    const relation = sql(await tableRelation('Overlap Stores'))
    try {
      // An ordinary save: its before_lock taken, its row lock still to come.
      const copyDone = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(971)`
        const copy = admin.post<{ changed: number }>(AGAIN, {})
        await new Promise((done) => setTimeout(done, 400))
        await tx.unsafe(`set local lock_timeout = '1s'`)
        // The copy waits at the same lock, holding no row the save needs.
        await tx`select 1 from ${relation} where row_id = 'S002' for update`
        return { copy }
      })
      expect((await copyDone.copy).changed).toBe(1)
    } finally {
      unregisterController(controller as never)
      await changeStandin(dir, 'sales', ["update stores set name = 'Harbour Road' where code = 'S001'"])
    }
  })

  test('the standing wait outlasts the slowest copy seen on staging', () => {
    const { attemptSeconds, pauseSeconds, attempts } = DEPLOY_LOCK_WAIT
    expect(attempts * attemptSeconds + (attempts - 1) * pauseSeconds).toBeGreaterThan(126)
  })
})

describe('the data source changes during the read', () => {
  // As a deploy's settings file may, between the read and the apply.
  const change = () => sql`update data_source set table_allowlist = 'sales.main.other' where row_id = 'overlap'`

  test('Copy again is refused, and no row changes', async ({ admin }) => {
    await makeCopy(admin)
    const runs = await sql`select 1 from import_log where ref_table = 'Overlap Stores'`
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post(AGAIN, {})
      await read.reached
      await change()
      read.release()
      await expectRefused(copy, 409, 'changed while the source was read')
    } finally { gates.read = undefined; read.release() }
    expect(await sql`select 1 from import_log where ref_table = 'Overlap Stores'`).toHaveLength(runs.length)
  })

  test('a first copy is refused, and no Table is made', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'overlap', databases: ['sales'] })
    const read = stall()
    gates.read = read.wait
    try {
      const made = admin.post(`${SOURCES}/overlap:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Overlap Stores', key: 'code', columns: COLUMNS })
      await read.reached
      await change()
      read.release()
      await expectRefused(made, 409)
    } finally { gates.read = undefined; read.release() }
    expect(await sql`select 1 from table_def where name = 'Overlap Stores'`).toHaveLength(0)
  })

  test('a status a read writes is not a change', async ({ admin }) => {
    await makeCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post<{ unchanged: number }>(AGAIN, {})
      await read.reached
      await sql`update data_source set conn_status = 'error', last_checked_at = now(), last_error = 'seen by another read' where row_id = 'overlap'`
      read.release()
      expect((await copy).unchanged).toBe(3)
    } finally { gates.read = undefined; read.release() }
  })
})

describe('the owning app changes during the read', () => {
  const NAME = 'copyowner.store'
  const PATH = `/api/table/${NAME}`
  async function ownedCopy(admin: TestClient) {
    await admin.post('/api/install_app', { manifest: { name: 'copyowner', tables: [{ name: NAME, label: 'Owned store', id_pattern: 'prompt', columns: [
      { column_name: 'code', column_type: 'Data', unique: true },
      { column_name: 'title', column_type: 'Text' },
      { column_name: 'deleted_at_source', column_type: 'Check', read_only: true, default_value: '0' },
    ] }] } })
    await sql`update column_def set source_column = 'code' where parent = ${NAME} and column_name = 'code'`
    await sql`update column_def set source_column = 'name' where parent = ${NAME} and column_name = 'title'`
    invalidateMeta(NAME)
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'overlap', databases: ['sales'] })
    await sql`insert into featherbase.table_copy (target_table, data_source, database, source_schema, source_table, key_column)
      values (${NAME}, 'overlap', 'sales', 'main', 'stores', 'code')`
  }

  test('with no change, the copy applies', async ({ admin }) => {
    await ownedCopy(admin)
    await expect(admin.post(`${PATH}:copy_again`, {})).resolves.toMatchObject({ inserted: 3 })
  })

  test('upgraded meanwhile: refused cleanly, and no row changes', async ({ admin }) => {
    await ownedCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post(`${PATH}:copy_again`, {})
      await read.reached
      await sql`update installed_app set package_version = '9.9.9' where name = 'copyowner'`
      read.release()
      await expectRefused(copy, 409, 'was upgraded while this read ran')
    } finally { gates.read = undefined; read.release() }
    expect(await sql`select 1 from copyowner.store`).toHaveLength(0)
    expect(await sql`select 1 from import_log where ref_table = ${NAME}`).toHaveLength(0)
  })

  test('disabled meanwhile: refused, and no row changes', async ({ admin }) => {
    await ownedCopy(admin)
    const read = stall()
    gates.read = read.wait
    try {
      const copy = admin.post(`${PATH}:copy_again`, {})
      await read.reached
      await sql`update installed_app set enabled = false where name = 'copyowner'`
      read.release()
      await expectRefused(copy, 403)
    } finally { gates.read = undefined; read.release() }
    expect(await sql`select 1 from copyowner.store`).toHaveLength(0)
  })
})
