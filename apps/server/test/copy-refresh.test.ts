import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { test } from './pg-test'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import { sql } from '../src/db'
import { expectRefused, grantRole } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'
import { enqueue, jobRegistrant, registerJob, runOneJob } from '../src/jobs'
import { registerCopyRefreshJobs } from '../src/copy-refresh'
import { invalidateMeta } from '../src/meta'
import { runMigrations } from '../src/migrate'

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir); overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); overrideVariable('MOTHERDUCK_TOKEN', undefined); rmSync(dir, { recursive: true, force: true }) })

async function makeCopy(admin: TestClient, sourceTable = 'stores') {
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name: 'refresh-test', databases: ['sales'] })
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
    await expectRefused(admin.post(write, { cadence: 'every minute', enabled: true }), 417)
    await expectRefused(admin.post('/api/table/Person:set_copy_schedule', { cadence: 'hourly', enabled: true }), 404)
    expect(await admin.get(path)).toBeNull()
    const schedule = await admin.post<{ row_id: string; method: string; cadence: string }>(write, { cadence: 'hourly', enabled: true })
    expect(schedule).toMatchObject({ cadence: 'hourly', enabled: true })
    const changed = await admin.post(write, { cadence: 'daily', enabled: false })
    expect(changed).toMatchObject({ row_id: schedule.row_id, cadence: 'daily', enabled: false })
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
    expect(await admin.get(path)).toMatchObject({ row_id: schedule.row_id, enabled: false })
  })

  test('a provisional schedule survives the final migration identity', async ({ admin }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    const before = await admin.get('/api/table/Scheduled%20Stores:copy_schedule')
    const info = await admin.get('/api/table/Scheduled%20Stores:copy_info')
    await sql`delete from migration where name = '0010_copy_refresh_schedule.sql'`
    await sql`insert into migration (name) values ('0008_copy_refresh_schedule.sql')`
    await runMigrations(() => {})
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_schedule')).toEqual(before)
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_info')).toEqual(info)
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Harbour Road' })
    await admin.delete('/api/table/Data%20Source/refresh-test')
    expect(await sql`select row_id from scheduled_job where method = ${schedule.method}`).toHaveLength(0)
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
  })

  test('ordinary editors cannot administer a refresh', async ({ admin, createUser }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await grantRole(admin, { role: 'Refresh Editor', table: ['Scheduled Job', 'Person'], can_read: true, can_write: true, can_create: true, can_delete: true })
    const user = await createUser({ roles: ['Refresh Editor'] })
    await expectRefused(user.post('/api/table/Person:set_copy_schedule', { enabled: true, cadence: 'hourly' }), 403)
    await expectRefused(user.post('/api/save_row', { table: 'Scheduled Job', row: { method: 'copy_refresh_fake', cadence: 'hourly', enabled: true } }), 403)
    await expectRefused(user.delete(`/api/table/Scheduled%20Job/${schedule.method}`), 403)
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_schedule')).toMatchObject({ enabled: true })
  })

  test('nobody can rename a copied-table refresh, so its handler keeps its linkage', async ({ admin, createUser }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ row_id: string; method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await grantRole(admin, { role: 'Rename Editor', table: ['Scheduled Job'], can_read: true, can_write: true, can_create: true, can_delete: true })
    const user = await createUser({ roles: ['Rename Editor'] })
    const url = `/api/table/Scheduled%20Job/${schedule.row_id}:rename`
    await expectRefused(user.post(url, { new_name: 'renamed_refresh' }), 417)
    await expectRefused(admin.post(url, { new_name: 'renamed_refresh' }), 417)
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_schedule')).toMatchObject({ row_id: schedule.row_id, method: schedule.method })
  })

  test('a refresh rejects the every-minute cadence through ordinary job editing', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { table: 'Scheduled Job', row: { method: 'copy_refresh_fake', cadence: 'every minute', enabled: true } })).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  })

  test('the worker records an unchanged source observation', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    // A caller-controlled payload cannot redirect this privileged handler.
    await sql`update background_job set run_at = now(), payload = '{"target":"Person"}'::jsonb where method = ${schedule.method}`
    expect(await runOneJob()).toBe(true)
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    expect(String(execution.result)).toContain('3 unchanged')
    expect(String(execution.result)).toContain('0 changed')
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(1)
  })

  test('an archived copy is skipped, not failed, until it is un-archived (#905)', async ({ admin }) => {
    await makeCopy(admin)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await admin.post('/api/table_def/Scheduled%20Stores/archive', { note: 'Replaced by a newer copy' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    expect(await runOneJob()).toBe(true)
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution).toEqual({ outcome: 'success', result: 'Skipped: Scheduled Stores is archived' })
  })

  test('a new scheduled conflict reaches the responsible administrators', async ({ admin, createUser }) => {
    await changeStandin(dir, 'sales', ['create table notice_stores as select * from stores'])
    await makeCopy(admin, 'notice_stores')
    await createUser({ email: 'copy.owner840@example.test', roles: ['System Manager'] })
    const row = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S001')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S001', title: 'Private correction', updated_at: row.updated_at } })
    const second = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S002')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S002', title: 'Second private correction', updated_at: second.updated_at } })
    await changeStandin(dir, 'sales', ["update notice_stores set name = 'Private source value' where code in ('S001', 'S002')"])
    invalidateSources('refresh-test') // The stand-in snapshots its files per session.
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    const [notice] = await sql`select subject, body from email_queue where recipient = 'copy.owner840@example.test' and subject like 'Copy refresh conflicts:%'`
    expect(notice?.subject).toBe('Copy refresh conflicts: Scheduled Stores')
    expect(notice?.body).toContain('2 new conflicts')
    expect(notice?.body).not.toContain('Private')
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Private correction' })
  })

  test('with no System Manager to mail, a scheduled conflict is recorded as undelivered', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table unmailed_stores as select * from stores'])
    await makeCopy(admin, 'unmailed_stores')
    const row = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S001')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S001', title: 'Kept correction', updated_at: row.updated_at } })
    await changeStandin(dir, 'sales', ["update unmailed_stores set name = 'Unmailed source value' where code = 'S001'"])
    invalidateSources('refresh-test')
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await sql`update background_job set run_at = now() where method = ${schedule.method}`
      await runOneJob()
    } finally { warn.mockRestore() }
    const [execution] = await sql`select outcome from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    const undelivered = await sql`select operation from activity_log where operation like 'notice_undelivered:%copy refresh conflicts: Scheduled Stores%'`
    expect(undelivered).toHaveLength(1)
  })

  test('schedules saved earlier are registered again when the server starts', async ({ admin }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ row_id: string; method: string; updated_at: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'daily' })
    await registerCopyRefreshJobs()
    expect(jobRegistrant(schedule.method)).toBeTruthy()
    // An ordinary job save that leaves the cadence out keeps the saved one.
    await admin.post('/api/save_row', { table: 'Scheduled Job', row: { row_id: schedule.row_id, enabled: false, updated_at: schedule.updated_at } })
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_schedule')).toMatchObject({ cadence: 'daily', enabled: false })
    // A database still awaiting migration 0010 registers nothing and does not fail.
    await sql`alter table featherbase.copy_refresh_schedule rename to copy_refresh_schedule_awaiting`
    await expect(registerCopyRefreshJobs()).resolves.toBeUndefined()
    await sql`alter table featherbase.copy_refresh_schedule_awaiting rename to copy_refresh_schedule`
  })

  test('schedule requests name a copied table and say whether it is enabled', async ({ admin }) => {
    await makeCopy(admin)
    await expectRefused(admin.get('/api/table/Person:copy_schedule'), 404)
    await expectRefused(admin.post('/api/table/Scheduled%20Stores:set_copy_schedule', { cadence: 'hourly', enabled: 'yes' }), 417)
  })

  test('a conflict notice job names a copied table, and gives up after a day of refusals (#934)', async ({ admin, createUser }) => {
    await makeCopy(admin)
    await createUser({ email: 'copy.notice934@example.test', roles: ['System Manager'] })
    await sql`delete from background_job`
    // A queued payload cannot point the notice at a table that is not a copy.
    await enqueue('copy_refresh_conflict_notice', { table: 'Person', conflicts: 1 }, { runAt: new Date(0) })
    await runOneJob()
    expect(await sql`select job_status from background_job where method = 'copy_refresh_conflict_notice'`).toEqual([{ job_status: 'failed' }])
    await sql`delete from background_job`
    await sql`create function featherbase.refuse_refresh_notice() returns trigger language plpgsql as $$
      begin raise exception 'notice queue unavailable'; end $$`
    await sql`create trigger refuse_refresh_notice before insert on featherbase.email_queue
      for each row execute function featherbase.refuse_refresh_notice()`
    await enqueue('copy_refresh_conflict_notice', { table: 'Scheduled Stores', conflicts: 2, tries: 96 }, { runAt: new Date(0) })
    await runOneJob()
    const [last] = await sql`select job_status, error from background_job where method = 'copy_refresh_conflict_notice'`
    expect(last).toMatchObject({ job_status: 'failed', error: expect.stringContaining('could not be queued for a day') })
  })

  test('a notice outage does not retry a committed refresh', async ({ admin, createUser }) => {
    await changeStandin(dir, 'sales', ['create table outage_stores as select * from stores'])
    await makeCopy(admin, 'outage_stores')
    await createUser({ email: 'copy.outage840@example.test', roles: ['System Manager'] })
    const row = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S001')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S001', title: 'Personal correction', updated_at: row.updated_at } })
    await changeStandin(dir, 'sales', ["update outage_stores set name = 'New source value' where code in ('S001', 'S002')"])
    invalidateSources('refresh-test')
    // Fail at the real queue boundary, after the atomic copy has committed.
    await sql`create function featherbase.refuse_refresh_notice() returns trigger language plpgsql as $$
      begin raise exception 'notice queue unavailable'; end $$`
    await sql`create trigger refuse_refresh_notice before insert on featherbase.email_queue
      for each row execute function featherbase.refuse_refresh_notice()`
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    expect(execution.result).toContain('Conflict notice could not be queued')
    expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Personal correction' })
    expect(await admin.get('/api/table/Scheduled%20Stores/S002')).toMatchObject({ title: 'New source value' })
    const info = await admin.get<{ last_run_id: string }>('/api/table/Scheduled%20Stores:copy_info')
    expect(execution.result).toContain(`batch ${info.last_run_id}`)
    const queued = await sql`select attempts, run_at > now() as future from background_job where method = ${schedule.method} and job_status = 'queued'`
    expect(queued).toEqual([{ attempts: 0, future: true }])
    await admin.post('/api/table/Scheduled%20Stores:import-revert', { run_id: info.last_run_id })
    expect(await admin.get('/api/table/Scheduled%20Stores/S002')).toMatchObject({ title: 'Hill Street' })
    // #934: the notice is not lost. It waits in its own job, apart from the
    // copy, and goes out once the queue is back, with no new import batch.
    const [notice] = await sql`select payload, run_at > now() as later from background_job
      where method = 'copy_refresh_conflict_notice' and job_status = 'queued'`
    expect(notice).toMatchObject({ payload: { table: 'Scheduled Stores', conflicts: 1 }, later: true })
    await runOneJob() // too early: nothing runs
    expect(await sql`select 1 from featherbase.email_queue where subject = 'Copy refresh conflicts: Scheduled Stores'`).toEqual([])
    // Still refused when it is due: it tries again later, it does not fail.
    await sql`update background_job set run_at = now() where method = 'copy_refresh_conflict_notice'`
    await runOneJob()
    const [retry] = await sql`select payload, run_at > now() as later from background_job
      where method = 'copy_refresh_conflict_notice' and job_status = 'queued'`
    expect(retry).toMatchObject({ payload: { table: 'Scheduled Stores', conflicts: 1, tries: 2 }, later: true })
    await sql`drop trigger refuse_refresh_notice on featherbase.email_queue`
    await sql`update background_job set run_at = now() where method = 'copy_refresh_conflict_notice'`
    const batches = (await sql`select count(*)::int as n from featherbase.import_log where ref_table = 'Scheduled Stores'`)[0].n
    await runOneJob()
    const sent = await sql`select recipient, body from featherbase.email_queue where subject = 'Copy refresh conflicts: Scheduled Stores'`
    expect(sent.map((m) => m.recipient)).toContain('copy.outage840@example.test')
    expect(sent[0].body).toContain('1 new conflict')
    expect((await sql`select count(*)::int as n from featherbase.import_log where ref_table = 'Scheduled Stores'`)[0].n).toBe(batches)
    expect(await sql`select 1 from background_job where method = 'copy_refresh_conflict_notice' and job_status = 'queued'`).toEqual([])
  })

  test('a refresh whose notice cannot even wait in a job still is not retried (#934)', async ({ admin, createUser }) => {
    await changeStandin(dir, 'sales', ['create table keep_stores as select * from stores'])
    await makeCopy(admin, 'keep_stores')
    await createUser({ email: 'copy.keep934@example.test', roles: ['System Manager'] })
    const row = await admin.get<{ updated_at: string }>('/api/table/Scheduled%20Stores/S001')
    await admin.post('/api/save_row', { table: 'Scheduled Stores', row: { row_id: 'S001', title: 'Personal correction', updated_at: row.updated_at } })
    await changeStandin(dir, 'sales', ["update keep_stores set name = 'New source value' where code in ('S001', 'S002')"])
    invalidateSources('refresh-test')
    await sql`create function featherbase.refuse_refresh_notice() returns trigger language plpgsql as $$
      begin raise exception 'notice queue unavailable'; end $$`
    await sql`create trigger refuse_refresh_notice before insert on featherbase.email_queue
      for each row execute function featherbase.refuse_refresh_notice()`
    await sql`create trigger refuse_notice_job before insert on featherbase.background_job
      for each row when (new.method = 'copy_refresh_conflict_notice') execute function featherbase.refuse_refresh_notice()`
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    await runOneJob()
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    expect(execution.result).toContain('Conflict notice could not be queued or kept for later')
    const queued = await sql`select attempts, run_at > now() as future from background_job where method = ${schedule.method} and job_status = 'queued'`
    expect(queued).toEqual([{ attempts: 0, future: true }])
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

  for (const [kind, mutation] of [
    ['duplicate_key', "update failure_duplicate_key set code = 'S001' where code = 'S002'"],
    ['missing_column', 'alter table failure_missing_column drop column name'],
    ['unavailable_relation', 'drop table failure_unavailable_relation'],
  ]) {
    test(`a ${kind} source fails visibly without changing the target`, async ({ admin }) => {
      const source = `failure_${kind}`
      await changeStandin(dir, 'sales', [`create table ${source} as select * from stores`])
      await makeCopy(admin, source)
      const [{ n: before }] = await sql`select count(*)::int as n from import_log where ref_table = 'Scheduled Stores'`
      await changeStandin(dir, 'sales', [mutation])
      invalidateSources('refresh-test')
      await sql`delete from background_job`
      const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
      await sql`update background_job set run_at = now(), max_attempts = 1 where method = ${schedule.method}`
      await runOneJob()
      expect((await sql`select outcome from job_execution where method = ${schedule.method}`)[0].outcome).toBe('error')
      expect(await admin.get('/api/table/Scheduled%20Stores/S001')).toMatchObject({ title: 'Harbour Road' })
      expect(await admin.get('/api/table/Scheduled%20Stores/S002')).toMatchObject({ title: 'Hill Street' })
      expect((await sql`select count(*)::int as n from import_log where ref_table = 'Scheduled Stores'`)[0].n).toBe(before)
    })
  }

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

  test('a stale invocation fails terminally after its schedule is removed', async ({ admin }) => {
    await makeCopy(admin)
    const schedule = await admin.post<{ method: string }>('/api/table/Scheduled%20Stores:set_copy_schedule', { enabled: true, cadence: 'hourly' })
    await admin.delete(`/api/table/Scheduled%20Job/${schedule.method}`)
    await sql`delete from background_job`
    const info = await admin.get('/api/table/Scheduled%20Stores:copy_info')
    const job = await admin.post<{ name: string }>('/api/enqueue_job', { method: schedule.method, repeat_every: 3600 })
    await sql`update background_job set run_at = now() where row_id = ${job.name}`
    await runOneJob()
    const [finished] = await sql`select job_status, error from background_job where row_id = ${job.name}`
    expect(finished.job_status).toBe('failed')
    expect(finished.error).toContain('schedule has been removed')
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_info')).toEqual(info)
    expect(await sql`select row_id from background_job where method = ${schedule.method} and job_status = 'queued'`).toHaveLength(0)
    expect(await admin.get('/api/table/Scheduled%20Stores:copy_schedule')).toBeNull()
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
