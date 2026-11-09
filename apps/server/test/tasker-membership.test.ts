import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { installApp } from '../src/apps'
import { taskerClient } from './tasker-client'
import { expectRefused } from './fixtures'

test('Tasker membership excludes a signed-in non-member', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const outsider = taskerClient(await createUser({ roles: [] }))
  await expectRefused(outsider.get('/api/table/tasker.task'), 403)
})

test('a new capture is private to its creator', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Prepare my notes' } })
  await expectRefused(teammate.get(`/api/table/tasker.task/${task.row_id}`), 403)
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
  await expectRefused(creator.post('/api/save_row', { table: 'tasker.task', row: { row_id: shared.row_id, updated_at: shared.updated_at, shared: false } }), 417)
})

test('a private question cannot request a teammate reply', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Private question notes' } })
  await expectRefused(creator.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'Could you check this?', reply_needed_from: teammate.user } }), 417)
})

test('audit lists hide protected task references when its app is disabled', async ({ createUser }) => {
  const { setAppEnabled } = await import('../src/apps')
  const { logAccess } = await import('../src/audit')
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member', 'System Manager'] }))
  const task = await owner.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Private audit context' } })
  await logAccess(owner.user!, 'print', { table: 'tasker.task', row_id: task.row_id, method: 'pdf' })
  const query = new URLSearchParams({ fields: JSON.stringify(['reference_name']), filters: JSON.stringify([['ref_table', '=', 'tasker.task']]) })
  const path = `/api/table/Access%20Log?${query}`
  expect(await owner.get(path)).toMatchObject({ total: 1, data: [{ reference_name: task.row_id }] })
  await setAppEnabled('tasker', false)
  expect(await owner.get(path)).toMatchObject({ total: 0, data: [] })
})

test('an app collection without its storage mapping is refused instead of inferred', async () => {
  const { sql } = await import('../src/db')
  const { invalidateMeta } = await import('../src/meta')
  const { tableRelation } = await import('../src/table-engine')
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  await sql`update table_def set owner_app = null, physical_schema = null, physical_relation = null where name = 'tasker.task'`
  invalidateMeta('tasker.task')
  await expect(tableRelation('tasker.task')).rejects.toMatchObject({ type: 'ValidationError', message: 'Table tasker.task has no app storage mapping' })
})
