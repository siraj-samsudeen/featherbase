import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { taskerClient } from './tasker-client'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }

async function install() {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
}

test('members share one store list and can add to it', async ({ createUser }) => {
  await install()
  const asha = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const ravi = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const store = await asha.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store', store_type: 'Store' } })
  await ravi.post('/api/save_row', { table: 'tasker.store', row: { store_name: 'Manimangalam WH', store_type: 'Warehouse' } })
  const seen = await asha.get<{ data: Row[] }>('/api/table/tasker.store?fields=["row_id","store_name","store_type"]&order_by=store_name asc')
  expect(seen.data.map(row => [row.store_name, row.store_type])).toEqual([['Keelkattalai Store', 'Store'], ['Manimangalam WH', 'Warehouse']])
  const task = await ravi.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Reconcile stock variance', store: store.row_id, start_date: '2026-11-01', due_date: '2026-11-04' } })
  const saved = await ravi.get<Row>(`/api/table/tasker.task/${task.row_id}`)
  expect([saved.store, String(saved.start_date).slice(0, 10), String(saved.due_date).slice(0, 10)]).toEqual([store.row_id, '2026-11-01', '2026-11-04'])
})

test('a due date before the start date is refused', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await member.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Reconcile stock variance', start_date: '2026-11-10' } })
  await expect(member.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, due_date: '2026-11-04' } }))
    .rejects.toThrow('The due date can’t be before the start date')
  const sameDay = await member.post<Row>('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, due_date: '2026-11-10' } })
  expect(String(sameDay.due_date).slice(0, 10)).toBe('2026-11-10')
})

test('a subtask belongs to its parent’s store', async ({ createUser }) => {
  await install()
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const keel = await member.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store' } })
  const avadi = await member.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Avadi Store' } })
  const parent = await member.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Reconcile stock variance', store: keel.row_id } })
  const child = await member.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Count the cold room', parent_task: parent.row_id } })
  expect(child.store).toBe(keel.row_id)
  expect(await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, store: avadi.row_id } })).toMatchObject({ store: keel.row_id })
})

test('another member’s private task in a store is not visible to count', async ({ createUser }) => {
  await install()
  const asha = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const ravi = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const keel = await asha.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store' } })
  const project = await asha.post<Row>('/api/save_row', { table: 'tasker.project', row: { project_name: 'September stock review' } })
  await asha.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Shared store work', store: keel.row_id, project: project.row_id } })
  await asha.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Asha’s private note', store: keel.row_id } })
  const seen = await ravi.get<{ data: Row[] }>(`/api/table/tasker.task?fields=["task_title"]&filters=${encodeURIComponent(JSON.stringify([['store', '=', keel.row_id]]))}`)
  expect(seen.data.map(row => row.task_title)).toEqual(['Shared store work'])
})
