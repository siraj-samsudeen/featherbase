import { afterAll, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { test } from './pg-test'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import { sql } from '../src/db'
import { grantRole } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'
import { registerJob, runOneJob } from '../src/jobs'
import { invalidateMeta } from '../src/meta'

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); rmSync(dir, { recursive: true, force: true }) })

async function makeCopy(admin: TestClient, sourceTable = 'stores') {
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name: 'refresh-test', token: STANDIN_TOKENS.reader, databases: ['sales'] })
  await admin.post('/api/table/Data%20Source/refresh-test:copy_create', {
    database: 'sales', schema: 'main', table: sourceTable, name: 'Scheduled Stores', key: 'code',
    columns: [{ source: 'code', column_name: 'code' }, { source: 'name', column_name: 'title' }],
  })
}

describe('Scheduled copied-table refresh', () => {
  test('a copied table has one administrator-controlled schedule', async ({ admin }) => {
    await makeCopy(admin)
    const path = '/api/table/Scheduled%20Stores:copy_schedule'
    expect(await admin.get(path)).toBeNull()
    const write = '/api/table/Scheduled%20Stores:set_copy_schedule'
    const schedule = await admin.post<{ row_id: string; method: string; cadence: string }>(write, { cadence: 'hourly', enabled: true })
    expect(schedule).toMatchObject({ cadence: 'hourly', enabled: true })
    const changed = await admin.post(write, { cadence: 'daily', enabled: false })
    expect(changed).toMatchObject({ row_id: schedule.row_id, cadence: 'daily', enabled: false })
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
    expect(await admin.get(path)).toMatchObject({ row_id: schedule.row_id, enabled: false })
  })

  test('ordinary editors cannot administer a refresh', async ({ admin, createUser }) => {
    await grantRole(admin, { role: 'Refresh Editor', table: ['Scheduled Job', 'Person'], can_read: true, can_write: true, can_create: true })
    const user = await createUser({ roles: ['Refresh Editor'] })
    await expect(user.post('/api/table/Person:set_copy_schedule', { enabled: true, cadence: 'hourly' })).rejects.toMatchObject({ status: 403 })
    await expect(user.post('/api/save_row', { table: 'Scheduled Job', row: { method: 'copy_refresh_fake', cadence: 'hourly', enabled: true } })).rejects.toMatchObject({ status: 403 })
  })

  test('a refresh rejects the every-minute cadence through ordinary job editing', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { table: 'Scheduled Job', row: { method: 'copy_refresh_fake', cadence: 'every minute', enabled: true } })).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  })

  test('the worker records an unchanged source observation', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    expect(await runOneJob()).toBe(true)
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    expect(String(execution.result)).toContain('3 unchanged')
    expect(String(execution.result)).toContain('0 changed')
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(1)
  })

  test('a new scheduled conflict reaches the responsible administrators', async ({ admin, createUser }) => {
    await changeStandin(dir, 'sales', ['create table notice_stores as select * from stores'])
    await makeCopy(admin, 'notice_stores')
    await createUser({ email: 'copy.owner840@example.test', roles: ['System Manager'] })
    const row = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S001')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S001', title: 'Private correction', updated_at: row.updated_at } })
    await changeStandin(dir, 'sales', ["update notice_stores set name = 'Private source value' where code = 'S001'"])
    invalidateSources('refresh-test') // The stand-in snapshots its files per session.
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    const [notice] = await sql`select subject, body from email_queue where recipient = 'copy.owner840@example.test' and subject like 'Copy refresh conflicts:%'`
    expect(notice?.subject).toBe('Copy refresh conflicts: Scheduled Stores')
    expect(notice?.body).toContain('1 new conflict')
    expect(notice?.body).not.toContain('Private')
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Private correction' })
  })

  test('a scheduled change is an undoable system observation', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table actor_stores as select * from stores'])
    await makeCopy(admin, 'actor_stores')
    await changeStandin(dir, 'sales', ["update actor_stores set name = 'Source change' where code = 'S001'"])
    invalidateSources('refresh-test')
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Source change' })
    const info = await admin.get<{ last_run_id: string }>('/api/table/Scheduled%20Stores:copy_info')
    const versions = await sql`select created_by, data from version where ref_table = 'Scheduled Stores' and data->>'import_run' = ${info.last_run_id}`
    expect(versions.length).toBeGreaterThan(0)
    expect(versions.every(v => String(v.created_by).startsWith('copy-refresh:'))).toBe(true)
    await admin.post('/api/table/Scheduled%20Stores:import-revert', { run_id: info.last_run_id })
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Harbour Road' })
  })

  test('a later invalid candidate rolls back the whole scheduled copy', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table atomic_stores as select * from stores'])
    await makeCopy(admin, 'atomic_stores')
    await sql`update column_def set reqd = true where parent = 'Scheduled Stores' and column_name = 'title'`
    invalidateMeta()
    const [{ n: before }] = await sql`select count(*)::int as n from import_log where ref_table = 'Scheduled Stores'`
    await changeStandin(dir, 'sales', ["update atomic_stores set name = case when code = 'S001' then 'Valid first change' when code = 'S002' then null else name end"])
    invalidateSources('refresh-test')
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now(), max_attempts = 1 where method = ${schedule.method}`
    await runOneJob()
    const [execution] = await sql`select outcome from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('error')
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Harbour Road' })
    expect(await admin.get('/api/table/Scheduled%20Stores/S002')).toMatchObject({ title: 'Hill Street' })
    expect((await sql`select count(*)::int as n from import_log where ref_table = 'Scheduled Stores'`)[0].n).toBe(before)
    expect(await sql`select row_id from featherbase.import_conflict where ref_table = 'Scheduled Stores'`).toHaveLength(0)
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(1)
  })

  test('source removal withdraws its pending refresh', async ({ admin }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await admin.delete('/api/table/Data%20Source/refresh-test')
    expect(await sql`select row_id from scheduled_job where method = ${schedule.method}`).toHaveLength(0)
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ code: 'S001', title: 'Harbour Road' })
  })

  test('target removal withdraws provenance without erasing import history', async ({ admin }) => {
    await makeCopy(admin)
    const [log] = await sql`select row_id from import_log where ref_table = 'Scheduled Stores' limit 1`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await admin.delete('/api/table_def/Scheduled%20Stores')
    expect(await sql`select target_table from featherbase.table_copy where target_table = 'Scheduled Stores'`).toHaveLength(0)
    expect(await sql`select row_id from scheduled_job where method = ${schedule.method}`).toHaveLength(0)
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
    expect(await sql`select row_id from import_log where row_id = ${log.row_id}`).toHaveLength(1)
    await admin.delete('/api/table/Data%20Source/refresh-test')
  })

  test('a removed schedule cannot restart itself after an in-flight run', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    registerJob(schedule.method, async () => {
      await admin.delete(`/api/table/Scheduled%20Job/${schedule.method}`)
    })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
  })
})
