import { expect } from 'vitest'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { installApp } from '../src/apps'
import { taskerClient } from './tasker-client'
import { expectRefused } from './fixtures'

test('questions keep replies with their task and only the asker controls resolution', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const asker = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Team delivery' } })
  const task = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review delivery', project: project.row_id } })
  const other = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Other work', project: project.row_id } })
  const question = await asker.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'When will it arrive?', reply_needed_from: teammate.user } })
  const reply = await teammate.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Reply', parent_message: question.row_id, body: 'Friday morning' } })
  expect(reply).toMatchObject({ parent_message: question.row_id, created_by: teammate.user })
  await expectRefused(teammate.post('/api/save_row', { table: 'tasker.discussion', row: { row_id: question.row_id, updated_at: question.updated_at, resolved: true } }), 417)
  await expectRefused(teammate.post('/api/save_row', { table: 'tasker.discussion', row: { task: other.row_id, kind: 'Reply', parent_message: question.row_id, body: 'Wrong task' } }), 417)
  await expectRefused(teammate.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Reply', parent_message: reply.row_id, body: 'Nested reply' } }), 417)
  const resolved = await asker.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.discussion', row: { row_id: question.row_id, updated_at: question.updated_at, resolved: true } })
  expect(resolved.resolved).toBe(true)
  expect(await asker.post('/api/save_row', { table: 'tasker.discussion', row: { row_id: resolved.row_id, updated_at: resolved.updated_at, resolved: false } })).toMatchObject({ resolved: false })
})
