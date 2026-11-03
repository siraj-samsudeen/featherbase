import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { installApp } from '../src/apps'
import { taskerClient } from './tasker-client'

test('Tasker membership excludes a signed-in non-member', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const outsider = taskerClient(await createUser({ roles: [] }))
  await expect(outsider.get('/api/table/tasker.task')).rejects.toMatchObject({ status: 403 })
})

test('a new capture is private to its creator', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Prepare my notes' } })
  await expect(teammate.get(`/api/table/tasker.task/${task.row_id}`)).rejects.toMatchObject({ status: 403 })
})

test('moving a capture to a project shares it permanently', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Team review' } })
  const task = await creator.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Prepare my notes' } })
  const shared = await creator.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, project: project.row_id } })
  expect(await teammate.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ shared: true })
  await expect(creator.post('/api/save_row', { table: 'tasker.task', row: { row_id: shared.row_id, updated_at: shared.updated_at, shared: false } })).rejects.toMatchObject({ status: 417 })
})

test('a private question cannot request a teammate reply', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Private question notes' } })
  await expect(creator.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'Could you check this?', reply_needed_from: teammate.user } })).rejects.toMatchObject({ status: 417 })
})
