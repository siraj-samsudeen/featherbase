import { expect, vi } from 'vitest'
import { test as databaseTest } from './pg-test'
import { resolve } from 'node:path'
import { discoverPackages } from '../src/runtime-packages'
import { installApp } from '../src/apps'
import { taskerClient } from './tasker-client'
import { enqueue, drainJobs } from '../src/jobs'
import { sql } from '../src/db'
import { issueSession } from '../src/auth'
import type { CreateUserFn } from 'feather-testing-postgres'
import { expectRefused } from './fixtures'

async function tick() {
  await enqueue('tasker.repeat_tasks', {})
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
  await drainJobs()
}

databaseTest('cancelling the active occurrence pauses its recurring series', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review delivery' } })
  const { result } = await member.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', {
    idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: 'weekly', interval: 1, anchor_date: '2026-11-02' },
  })
  const active = await member.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: active.updated_at, task_state: 'Cancelled', change_reason: 'No longer needed' } })
  await tick()
  expect(await member.get(`/api/table/tasker.recurrence/${result.seriesId}`)).toMatchObject({ paused: true, active_task: null, next_at: null })
})

databaseTest.for(['daily', 'weekly', 'monthly', 'after_completion'])('a due %s series creates fresh subtask snapshots', async (mode, { createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const member = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Monthly review', description: 'Collect current figures' } })
  const child = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Count stock', parent_task: task.row_id } })
  await member.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Update', body: 'Previous review notes' } })
  const { result } = await member.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', {
    idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: mode, interval: mode === 'after_completion' ? 7 : 1, anchor_date: '2026-11-02' },
  })
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, is_done: true } })
  const active = await member.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: active.updated_at, is_done: true } })
  await tick()
  const before = await member.get<{ active_task: string; next_at: string }>(`/api/table/tasker.recurrence/${result.seriesId}`)
  expect(before.active_task).toBe(task.row_id)
  expect(Date.parse(before.next_at)).toBeGreaterThan(Date.now())
  const future = Date.now() + 40 * 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(future)
    await tick()
  } finally { vi.useRealTimers() }
  const series = await member.get<{ active_task: string }>(`/api/table/tasker.recurrence/${result.seriesId}`)
  expect(series.active_task).not.toBe(task.row_id)
  expect(await member.get(`/api/table/tasker.task/${series.active_task}`)).toMatchObject({ task_title: 'Monthly review', description: 'Collect current figures', is_done: false, task_state: 'Not started', shared: false })
  const children = await member.get<{ data: Record<string, unknown>[] }>(`/api/table/tasker.task?fields=${encodeURIComponent(JSON.stringify(['row_id', 'task_title', 'is_done', 'task_state']))}&filters=${encodeURIComponent(JSON.stringify([['parent_task', '=', series.active_task]]))}`)
  expect(children.data).toHaveLength(1)
  expect(children.data[0]).toMatchObject({ task_title: 'Count stock', is_done: false, task_state: 'Not started' })
  const discussion = await member.get<{ data: unknown[] }>(`/api/table/tasker.discussion?filters=${encodeURIComponent(JSON.stringify([['task', '=', series.active_task]]))}`)
  expect(discussion.data).toEqual([])
  await tick()
  expect((await member.get<{ data: unknown[] }>(`/api/table/tasker.task?filters=${encodeURIComponent(JSON.stringify([['recurrence', '=', result.seriesId]]))}`)).data).toHaveLength(2)
})


async function completedSeries(createUser: CreateUserFn) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const signedIn = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const session = await issueSession(signedIn.user!, { expiresAt: Math.floor(Date.now() / 1000) + 100 * 86400 })
  const member = taskerClient({ ...signedIn, token: session.token })
  const task = await member.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Recurring stock review' } })
  const { result } = await member.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', {
    idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: 'after_completion', interval: 1, anchor_date: '1970-01-01' },
  })
  const active = await member.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await member.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: active.updated_at, is_done: true } })
  await tick()
  const series = await member.get<{ row_id: string; updated_at: string; active_task: string; next_at: string }>(`/api/table/tasker.recurrence/${result.seriesId}`)
  return { member, task, series }
}

async function createNextByWorker(createUser: CreateUserFn) {
  const setup = await completedSeries(createUser)
  const future = Date.now() + 40 * 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  try { vi.setSystemTime(future); await tick() } finally { vi.useRealTimers() }
  const series = await setup.member.get<{ active_task: string }>(`/api/table/tasker.recurrence/${setup.series.row_id}`)
  expect(series.active_task).not.toBe(setup.task.row_id)
  return { ...setup, current: series.active_task }
}

databaseTest('Undo Done cannot reopen a historical occurrence after its series advances', async ({ createUser }) => {
  const { member, task } = await createNextByWorker(createUser)
  const previous = await member.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: previous.updated_at, is_done: false } }), 417)
})

databaseTest('an occurrence keeps its original occurrence key', async ({ createUser }) => {
  const { member, current } = await createNextByWorker(createUser)
  const occurrence = await member.get<{ updated_at: string }>(`/api/table/tasker.task/${current}`)
  await expectRefused(member.post('/api/save_row', { table: 'tasker.task', row: { row_id: current, updated_at: occurrence.updated_at, occurrence_key: 'changed-slot' } }), 417)
})

databaseTest('a direct series edit cannot replace its computed next date', async ({ createUser }) => {
  const { member, series } = await completedSeries(createUser)
  const saved = await member.post<{ next_at: string }>('/api/save_row', { table: 'tasker.recurrence', row: { row_id: series.row_id, updated_at: series.updated_at, next_at: '2035-01-01T00:00:00.000Z' } })
  expect(saved.next_at).toBe(series.next_at)
})

databaseTest('direct saves cannot create a second unfinished occurrence by moving the series date', async ({ createUser }) => {
  const { member, series } = await completedSeries(createUser)
  const future = Date.now() + 40 * 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(future)
    await member.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'First direct occurrence', recurrence: series.row_id,
      occurrence_key: `${series.row_id}:${new Date(series.next_at).toISOString()}`,
    } })
    const current = await member.get<{ updated_at: string }>(`/api/table/tasker.recurrence/${series.row_id}`)
    const moved = await member.post<{ next_at: string }>('/api/save_row', { table: 'tasker.recurrence', row: {
      row_id: series.row_id, updated_at: current.updated_at, next_at: new Date(future - 86400_000).toISOString(),
    } })
    await expect(member.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Second direct occurrence', recurrence: series.row_id,
      occurrence_key: `${series.row_id}:${new Date(moved.next_at).toISOString()}`,
    } })).rejects.toMatchObject({ status: 417 })
  } finally { vi.useRealTimers() }
})

databaseTest('a member can schedule repeats for shared team work', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Shared operations' } })
  const task = await creator.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Shared stock review', project: project.row_id } })
  const result = await teammate.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', { idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: 'weekly', interval: 1, anchor_date: '2026-11-09' } })
  expect(result.result.seriesId).toBeTruthy()
})

databaseTest('sharing an occurrence carries into future copies', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Shared repeat work' } })
  const task = await creator.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Share this recurring review' } })
  const { result } = await creator.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', { idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: 'weekly', interval: 1, anchor_date: '2026-11-09' } })
  const current = await creator.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await creator.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: current.updated_at, project: project.row_id } })
  await tick()
  expect(await teammate.get(`/api/table/tasker.recurrence/${result.seriesId}`)).toMatchObject({ shared: true, active_task: task.row_id })
  const shared = await creator.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await creator.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: shared.updated_at, is_done: true } })
  await tick()
  const future = Date.now() + 8 * 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  try { vi.setSystemTime(future); await tick() } finally { vi.useRealTimers() }
  const next = await teammate.get<{ active_task: string }>(`/api/table/tasker.recurrence/${result.seriesId}`)
  expect(next.active_task).not.toBe(task.row_id)
  expect(await teammate.get(`/api/table/tasker.task/${next.active_task}`)).toMatchObject({ shared: true, project: project.row_id })
})

databaseTest('a recurring task keeps its store in every new occurrence', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const creator = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const store = await creator.post<{ row_id: string }>('/api/save_row', { table: 'tasker.store', row: { store_name: 'Keelkattalai Store' } })
  const task = await creator.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Check the cold-room temperature log', store: store.row_id } })
  const { result } = await creator.post<{ result: { seriesId: string } }>('/api/app_actions/tasker/start_recurrence', { idempotencyKey: crypto.randomUUID(), payload: { row_id: task.row_id, updated_at: task.updated_at, schedule_mode: 'weekly', interval: 1, anchor_date: '2026-11-09' } })
  const current = await creator.get<{ updated_at: string }>(`/api/table/tasker.task/${task.row_id}`)
  await creator.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: current.updated_at, is_done: true } })
  await tick()
  const future = Date.now() + 8 * 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  try { vi.setSystemTime(future); await tick() } finally { vi.useRealTimers() }
  const next = await creator.get<{ active_task: string }>(`/api/table/tasker.recurrence/${result.seriesId}`)
  expect(next.active_task).not.toBe(task.row_id)
  expect(await creator.get(`/api/table/tasker.task/${next.active_task}`)).toMatchObject({ store: store.row_id })
})
