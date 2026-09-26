import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test as base } from './pg-test'
import { taskerClient } from './tasker-client'
import { discoverPackages } from '../src/runtime-packages'
import { installApp, isInstalled, uninstallApp } from '../src/apps'
import { sql } from '../src/db'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser(options))),
})

async function install() {
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
}
const envelope = (task: Record<string, unknown>, confirm = false) => ({
  idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, confirm },
})
const promote = '/api/app_actions/tasker/promote'
const discard = '/api/app_actions/tasker/delete_accidental'

test('simple promotion copies optional Markdown, removes original and replays once', async ({ admin, createUser }) => {
  await install()
  const member = await createUser({ roles: [] })
  for (const description of [null, '## Receipt review\n\n- Check **37** units']) {
    const task = await member.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: `Simple ${description === null ? 'empty' : 'Markdown'}`, description } })
    expect(await sql`select row_id from version where ref_table = 'tasker.task' and ref_name = ${String(task.row_id)}`).toHaveLength(0)
    const request = envelope(task)
    const result = await member.post<{ result: { projectId: string; retainedTask: boolean } }>(promote, request)
    expect(result.result.retainedTask).toBe(false)
    expect(await member.post(promote, request)).toEqual(result)
    expect(await member.get(`/api/table/tasker.project/${result.result.projectId}`)).toMatchObject({ project_name: task.task_title, description })
    await expect(admin.get(`/api/table/tasker.task/${task.row_id}`)).rejects.toMatchObject({ status: 404 })
  }
  expect(await sql`select row_id from tasker.project`).toHaveLength(2)
})

test('each rich signal requires confirmation, including historical assignment after clearing it', async ({ admin }) => {
  await install()
  for (const signal of ['assignment', 'state', 'urgency', 'comment', 'history']) {
    let task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: {
      task_title: `Rich ${signal}`,
      ...(signal === 'assignment' ? { assigned_to: 'Administrator' } : {}),
      ...(signal === 'state' ? { task_state: 'On hold' } : {}),
      ...(signal === 'urgency' ? { urgent: true } : {}),
    } })
    if (signal === 'comment') await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: 'Keep 37 units of context' } })
    if (signal === 'history') {
      task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, assigned_to: 'Administrator' } })
      task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, assigned_to: null } })
    }
    const before = await admin.get(`/api/activity/tasker.task/${task.row_id}`)
    expect(await admin.post(promote, envelope(task))).toEqual({ result: { confirmationRequired: true } })
    expect(await sql`select row_id from tasker.project where project_name = ${String(task.task_title)}`).toHaveLength(0)
    expect(await admin.get(`/api/activity/tasker.task/${task.row_id}`)).toEqual(before)
    const request = envelope(task, true)
    const result = await admin.post<{ result: { projectId: string; retainedTask: boolean } }>(promote, request)
    expect(result.result.retainedTask).toBe(true)
    expect(await admin.post(promote, request)).toEqual(result)
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({
      row_id: task.row_id, assigned_to: task.assigned_to, urgent: task.urgent, task_state: task.task_state, project: result.result.projectId,
    })
    if (signal === 'comment') expect(await sql`select content from comment where ref_name = ${String(task.row_id)}`).toEqual([{ content: 'Keep 37 units of context' }])
  }
})

test('rich Personal promotion preserves its owner assignment while leaving Personal destination', async ({ admin }) => {
  await install()
  const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Personal project idea', personal_tasks_owner: 'Administrator', task_state: 'In progress' } })
  const { result } = await admin.post<{ result: { projectId: string } }>(promote, envelope(task, true))
  expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ assigned_to: 'Administrator', personal_tasks_owner: null, project: result.projectId, task_state: 'In progress' })
})

test('concurrent comment becomes rich and stale task edits reject before creating a project', async ({ admin }) => {
  await install()
  const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Concurrent promotion' } })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: 'Arrived after preview' } })
  expect(await admin.post(promote, envelope(task))).toEqual({ result: { confirmationRequired: true } })
  await admin.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, task_title: 'Changed title' } })
  await expect(admin.post(promote, envelope(task, true))).rejects.toMatchObject({ status: 417 })
  expect(await sql`select row_id from tasker.project`).toHaveLength(0)
})

test('failure after project creation rolls back project task and idempotency receipt', async ({ admin }) => {
  await install()
  const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Atomic failure' } })
  const request = envelope(task)
  await sql.unsafe(`create function pg_temp.fail_tasker_delete() returns trigger language plpgsql as $$ begin raise exception 'Injected deletion failure'; end $$`)
  await sql.unsafe(`create trigger fail_tasker_delete before delete on tasker.task for each row execute function pg_temp.fail_tasker_delete()`)
  try { await expect(admin.post(promote, request)).rejects.toMatchObject({ status: 500 }) }
  finally { await sql.unsafe('drop trigger fail_tasker_delete on tasker.task') }
  expect(await sql`select row_id from tasker.project`).toHaveLength(0)
  expect(await sql`select row_id from tasker.task`).toHaveLength(1)
  expect(await sql`select * from runtime_action_result`).toHaveLength(0)
  expect(await admin.post(promote, request)).toMatchObject({ result: { retainedTask: false } })
})

test('accidental deletion requires confirmation and refuses retained work, history and stale revision', async ({ admin }) => {
  await install()
  const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Accidental capture' } })
  await expect(admin.post(discard, envelope(task))).rejects.toMatchObject({ status: 417 })
  await expect(admin.post(discard, envelope({ ...task, updated_at: '2000-01-01' }, true))).rejects.toMatchObject({ status: 417 })
  const request = envelope(task, true)
  expect(await admin.post(discard, request)).toEqual({ result: { deleted: true } })
  expect(await admin.post(discard, request)).toEqual({ result: { deleted: true } })
  await expect(admin.get(`/api/table/tasker.task/${task.row_id}`)).rejects.toMatchObject({ status: 404 })
  const kept = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Keep discussion' } })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: kept.row_id, content: 'Meaningful discussion' } })
  expect(await admin.post(discard, envelope(kept, true))).toMatchObject({ result: { deleted: false, counts: { comments: 1 } } })
  expect(await admin.get(`/api/activity/tasker.task/${kept.row_id}`)).toMatchObject({ comments: [{ content: 'Meaningful discussion' }] })
})

test('Tasker raw DELETE cannot bypass missing revision or retained discussion', async ({ admin }) => {
  await install()
  const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Keep evidence through both delete paths' } })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content: 'Retain 37, not 83' } })
  await expect(admin.delete(`/api/table/tasker.task/${task.row_id}`)).rejects.toMatchObject({ status: 409 })
  await expect(admin.delete(`/api/table/tasker.task/${task.row_id}?updated_at=${encodeURIComponent(String(task.updated_at))}`)).rejects.toMatchObject({
    status: 417, fields: { comments: '1', versions: '0', references: '0' },
  })
  expect(await admin.post(discard, envelope(task, true))).toMatchObject({ result: { deleted: false, counts: { comments: 1 } } })
  expect(await admin.get(`/api/activity/tasker.task/${task.row_id}`)).toMatchObject({ comments: [{ content: 'Retain 37, not 83' }] })
  expect(await sql`select table_schema from information_schema.tables where table_name = 'runtime_action_result'`).toEqual([{ table_schema: 'featherbase' }])
  expect(await sql`select has_table_privilege('app_client', 'featherbase.runtime_action_result', 'select') as allowed`).toEqual([{ allowed: false }])
})

test('an attachment or shared access independently retains task identity across delete and promotion', async ({ admin, createUser }) => {
  await install()
  const member = await createUser({ roles: [] })
  for (const family of ['files', 'shares']) {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: `Retain ${family} independently` } })
    const table = family === 'files' ? 'File' : 'Share'
    const link = await admin.post<Record<string, unknown>>('/api/save_row', { table, row: family === 'files'
      ? { file_name: '37-unit-evidence.txt', ref_table: 'tasker.task', ref_name: task.row_id }
      : { share_table: 'tasker.task', share_name: task.row_id, user: member.user, read: true } })
    expect(await admin.post(discard, envelope(task, true))).toMatchObject({ result: { deleted: false, counts: { [family]: 1, comments: 0, versions: 0 } } })
    expect(await admin.post(promote, envelope(task))).toEqual({ result: { confirmationRequired: true } })
    const result = await admin.post<{ result: { projectId: string; retainedTask: boolean } }>(promote, envelope(task, true))
    expect(result.result.retainedTask).toBe(true)
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ row_id: task.row_id, project: result.result.projectId })
    expect(await admin.get(`/api/table/${table}/${link.row_id}`)).toMatchObject(family === 'files'
      ? { ref_table: 'tasker.task', ref_name: task.row_id }
      : { share_table: 'tasker.task', share_name: task.row_id })
  }
})
