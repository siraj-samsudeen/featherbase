import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from './pg-test'
import prototype from './tasker-prototype'
import { registerApp, installApp, loadInstalledApps } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

test('PKG-H1: prototype transition refuses occupied destinations without changing old work', async ({ admin }) => {
  registerApp(prototype)
  await installApp('task-management')
  const task = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Team Task', row: { task_title: 'Do not discard' } })
  await sql`create schema if not exists tasker`
  await sql`create table tasker.task (sentinel text)`
  const migration = await readFile(resolve('migrations/0090_tasker_prototype.sql'), 'utf8')
  await expect(sql.begin(async tx => { await tx.unsafe(migration) })).rejects.toThrow('refusing to merge or discard')
  expect(await admin.get(`/api/table/Team%20Task/${task.row_id}`)).toMatchObject({ task_title: 'Do not discard' })
})

test('PKG-H1: prototype transition preserves work, references, comments, focus and grants', async ({ admin, createUser }) => {
  registerApp(prototype)
  await installApp('task-management')
  const member = await createUser({ email: 'prototype-member@example.com', roles: [] })
  const project = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Team Project', row: { project_name: 'Transition project' },
  })
  const task = await member.post<{ row_id: string }>('/api/save_row', {
    table: 'Team Task', row: { task_title: 'Keep this work', project: project.row_id, task_state: 'In progress' },
  })
  const comment = await member.post<{ row_id: string }>('/api/save_row', { table: 'Comment', row: {
    ref_table: 'Team Task', ref_name: task.row_id, content: 'Keep this discussion',
  } })
  const version = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Version', row: {
    ref_table: 'Team Task', ref_name: task.row_id, data: { changed: ['task_state'] },
  } })
  const file = await admin.post<{ row_id: string }>('/api/save_row', { table: 'File', row: {
    file_name: 'transition-note.txt', ref_table: 'Team Task', ref_name: task.row_id,
  } })
  const share = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Share', row: {
    share_table: 'Team Task', share_name: task.row_id, user: member.user, read: true,
  } })
  await member.put('/api/user_settings/Task%20Management%20Focus', { task_ids: [task.row_id] })
  const migration = await readFile(resolve('migrations/0090_tasker_prototype.sql'), 'utf8')
  await sql.unsafe(migration)
  await sql.unsafe(migration)
  await sql.unsafe(await readFile(resolve('migrations/0091_runtime_api_only.sql'), 'utf8'))
  expect(await sql`select has_table_privilege('app_client', 'tasker.task', 'select') as allowed`).toMatchObject([{ allowed: false }])
  invalidateMeta()
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  await loadInstalledApps()
  expect(await member.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({
    task_title: 'Keep this work', project: project.row_id, task_state: 'In progress',
  })
  expect(await member.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ project_name: 'Transition project' })
  expect(await member.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: [task.row_id] } })
  const comments = await member.get<{ data: unknown[] }>(`/api/table/Comment?filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', 'tasker.task']]))}&fields=["content"]`)
  expect(comments.data).toEqual([{ content: 'Keep this discussion' }])
  expect(await sql`select ref_table from comment where row_id = ${comment.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select ref_table from version where row_id = ${version.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select ref_table from file where row_id = ${file.row_id}`).toEqual([{ ref_table: 'tasker.task' }])
  expect(await sql`select share_table from share where row_id = ${share.row_id}`).toEqual([{ share_table: 'tasker.task' }])
  const saved = await member.get<Record<string, unknown>>(`/api/table/tasker.task/${task.row_id}`)
  expect(await member.post('/api/save_row', { table: 'tasker.task', row: { ...saved, is_done: true } }))
    .toMatchObject({ task_state: 'Done', state_before_done: 'In progress' })
  expect(await sql`select to_regclass('public.team_task') as old, to_regclass('tasker.task') as current`)
    .toMatchObject([{ old: null, current: 'tasker.task' }])
})
