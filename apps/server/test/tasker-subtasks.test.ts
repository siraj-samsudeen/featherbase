import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { taskerClient } from './tasker-client'
import { expectRefused } from './fixtures'

async function install() {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
}

test('a subtask cannot contain another subtask', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const parent = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review' } })
  const child = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect figures', parent_task: parent.row_id } })
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Another level', parent_task: child.row_id } }), 417)
})

test('an open subtask prevents parent completion', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const parent = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review' } })
  await member.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect figures', parent_task: parent.row_id } })
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { row_id: parent.row_id, updated_at: parent.updated_at, is_done: true } }), 417)
})

test.for(['Done', 'Cancelled'])('a %s subtask permits explicit parent completion', async (state, { createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const parent = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review' } })
  const child = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect figures', parent_task: parent.row_id } })
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, task_state: state, change_reason: 'No longer needed' } })
  expect(await member.get(`/api/table/tasker.task/${parent.row_id}`)).toMatchObject({ task_state: 'Not started', is_done: false })
  expect(await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: parent.row_id, updated_at: parent.updated_at, is_done: true } })).toMatchObject({ task_state: 'Done', is_done: true })
})

test('a subtask reopens only after its completed parent reopens', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const parent = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review' } })
  const child = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect figures', parent_task: parent.row_id, task_state: 'Done' } })
  const completed = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { row_id: parent.row_id, updated_at: parent.updated_at, task_state: 'Done' } })
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, task_state: 'In progress' } }), 417)
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: completed.row_id, updated_at: completed.updated_at, task_state: 'In progress' } })
  expect(await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, task_state: 'In progress' } })).toMatchObject({ task_state: 'In progress' })
})

test('private subtask cannot be assigned to a teammate', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const parent = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Private review' } })
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Private step', parent_task: parent.row_id, assigned_to: teammate.user } }), 417)
})

test('sharing a parent makes its existing subtask accessible to teammates', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Team review' } })
  const parent = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review instructions' } })
  const child = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect team figures', parent_task: parent.row_id } })
  await expectRefused(teammate.get(`/api/table/tasker.task/${child.row_id}`), 403)
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: parent.row_id, updated_at: parent.updated_at, project: project.row_id } })
  expect(await teammate.get(`/api/table/tasker.task/${child.row_id}`)).toMatchObject({ task_title: 'Collect team figures', parent_task: parent.row_id })
})

test('a shared subtask may be assigned to another Tasker member', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Team review' } })
  const parent = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review', project: project.row_id } })
  const child = await member.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Collect figures', parent_task: parent.row_id, assigned_to: teammate.user } })
  expect(await teammate.get(`/api/table/tasker.task/${child.row_id}`)).toMatchObject({ assigned_to: teammate.user, project: project.row_id })
})
