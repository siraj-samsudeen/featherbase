import { getDoc, saveDoc } from '../src/document'
import { describe, expect } from 'vitest'
import { test as base } from './pg-test'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { taskerClient } from './tasker-client'
import { installApp, isInstalled, uninstallApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { resolve } from 'node:path'
import { expectRefused } from './fixtures'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser({ ...options, roles: [...new Set([...(options?.roles ?? []), 'Tasker Member'])] }))),
})

const APP = 'tasker'
const TASK = 'tasker.task'

async function install() {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
  const admin = await getDoc('Person', 'Administrator', 'Administrator')
  await saveDoc('Person', { ...admin, roles: [...admin.roles as Record<string, unknown>[], { role: 'Tasker Member' }] }, 'Administrator')
}

async function sharedProject(as: TestClient) {
  return as.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Team coordination' } })
}

describe('capture_neutral_task: title-only Inbox capture', () => {
  test('a title is enough; ownership, destination and urgency stay empty', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Review September stock variance' },
      })

      expect(task).toMatchObject({
        task_title: 'Review September stock variance',
        task_state: 'Not started',
        is_done: false,
        urgent: false,
        project: null,
        personal_tasks_owner: null,
        assigned_to: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('one_task_destination: one destination', () => {
  test('a task cannot belong to both a project and Personal tasks', async ({ admin }) => {
    await install()
    try {
      const project = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: 'tasker.project',
        row: { project_name: 'September stock review' },
      })

      await expect(
        admin.post('/api/save_row', {
          table: TASK,
          row: {
            task_title: 'Reconcile the first variance',
            project: project.row_id,
            personal_tasks_owner: 'Administrator',
          },
        }),
      ).rejects.toMatchObject({
        status: 417,
        message: expect.stringContaining('Choose either a project or Personal tasks, not both'),
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('personal_destination_assigns_owner: moving to Personal tasks assigns that list owner', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: {
          task_title: 'Prepare my review notes',
          personal_tasks_owner: 'Administrator',
        },
      })

      expect(task).toMatchObject({
        project: null,
        personal_tasks_owner: 'Administrator',
        assigned_to: 'Administrator',
        task_state: 'Not started',
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('completion_restores_state: completion shortcut', () => {
  test('completing a task with an unset optional state reopens it as Not started', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Resume a stock check with no state', task_state: 'Blocked' },
      })
      const unset = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, task_state: null },
      })
      expect(unset).toMatchObject({ task_state: null, is_done: false })

      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: unset.row_id, updated_at: unset.updated_at, is_done: true },
      })
      expect(done).toMatchObject({ task_state: 'Done', is_done: true, state_before_done: 'Not started' })

      await admin.post('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, is_done: false },
      })
      expect(await admin.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({
        task_state: 'Not started', is_done: false, state_before_done: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('choosing Done while ticking the checkbox preserves the preceding state for reopening', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Resolve the blocked stock review', task_state: 'Blocked' },
      })
      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, is_done: true, task_state: 'Done' },
      })
      expect(done).toMatchObject({ task_state: 'Done', is_done: true, state_before_done: 'Blocked' })

      const reopened = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, is_done: false },
      })
      expect(await admin.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({
        updated_at: reopened.updated_at,
        task_state: 'Blocked', is_done: false, state_before_done: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('choosing a state while reopening overrides the remembered state', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Stop the completed stock probe', task_state: 'In progress' },
      })
      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, is_done: true },
      })
      expect(done).toMatchObject({ task_state: 'Done', is_done: true, state_before_done: 'In progress' })

      const reopened = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, is_done: false, task_state: 'Cancelled', change_reason: 'No longer needed' },
      })
      expect(await admin.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({
        updated_at: reopened.updated_at,
        task_state: 'Cancelled', is_done: false, state_before_done: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('reopening without remembered history falls back to Not started', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Revisit a completed warehouse check', task_state: 'Blocked' },
      })
      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, is_done: true },
      })
      expect(done).toMatchObject({ task_state: 'Done', is_done: true, state_before_done: 'Blocked' })

      // The installed metadata hides this Data column but does not make it
      // read-only: a real API client can clear history on a completed task.
      const withoutHistory = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, state_before_done: null },
      })
      expect(withoutHistory).toMatchObject({ task_state: 'Done', is_done: true, state_before_done: null })

      const reopened = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: withoutHistory.row_id, updated_at: withoutHistory.updated_at, is_done: false },
      })
      expect(await admin.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({
        updated_at: reopened.updated_at,
        task_state: 'Not started', is_done: false, state_before_done: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('unticking Done restores the state that preceded completion', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Investigate stock variance', task_state: 'In progress' },
      })
      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, is_done: true },
      })

      expect(done).toMatchObject({
        task_state: 'Done',
        is_done: true,
        state_before_done: 'In progress',
      })

      const restored = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, is_done: false },
      })
      expect(restored).toMatchObject({
        task_state: 'In progress',
        is_done: false,
        state_before_done: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('direct Done and Cancelled choices keep the checkbox coherent', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Decide whether to continue the stock probe' },
      })
      const done = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, task_state: 'Done' },
      })
      expect(done).toMatchObject({ task_state: 'Done', is_done: true })

      const cancelled = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: done.row_id, updated_at: done.updated_at, task_state: 'Cancelled', change_reason: 'No longer needed' },
      })
      expect(cancelled).toMatchObject({ task_state: 'Cancelled', is_done: false })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('assignment_state_independent: responsibility and work state are independent', () => {
  test('assigning a task leaves it Not started', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Prepare the variance worksheet' },
      })
      const assigned = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: {
          row_id: task.row_id,
          updated_at: task.updated_at,
          assigned_to: 'Administrator',
        },
      })
      expect(assigned).toMatchObject({
        assigned_to: 'Administrator',
        task_state: 'Not started',
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('shared team visibility', () => {
  test('installation advertises one Tasker launch in the signed-in catalog', async ({
    admin,
  }) => {
    await install()
    try {
      expect(await admin.get('/api/app_catalog')).toEqual([
        { name: 'tasker', title: 'Tasker', href: '/tasker/' },
      ])
      expect(await sql`select row_id from home_page where module = 'Tasker'`).toEqual([])
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('team_shares_tasker_work: a member can update a task without being assigned', async ({
    admin,
    createUser,
  }) => {
    await install()
    try {
      const project = await sharedProject(admin)
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Choose a warehouse count date', project: project.row_id },
      })
      const member = await createUser({ roles: [] })

      const visible = await member.get<{ data: Record<string, unknown>[] }>(
        '/api/table/tasker.task?fields=%5B%22row_id%22%2C%22task_title%22%5D',
      )
      expect(visible.data).toContainEqual(
        expect.objectContaining({ task_title: 'Choose a warehouse count date' }),
      )
      const updated = await member.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, urgent: true, updated_at: task.updated_at },
      })
      expect(updated).toMatchObject({ urgent: true, assigned_to: null })
      const comment = await member.post<Record<string, unknown>>('/api/save_row', {
        table: 'Comment',
        row: { ref_table: TASK, ref_name: task.row_id, content: 'Waiting for warehouse input' },
      })
      expect(comment).toMatchObject({ content: 'Waiting for warehouse input' })
      const activity = await member.get<{
        comments: Record<string, unknown>[]
        versions: { data: { changed: [string, unknown, unknown][] } }[]
      }>(`/api/activity/${TASK}/${task.row_id}`)
      expect(activity.comments).toContainEqual(expect.objectContaining({ content: 'Waiting for warehouse input' }))
      expect(activity.versions.flatMap((version) => version.data.changed)).toContainEqual([
        'urgent', false, true,
      ])
      await expectRefused(member.get('/api/table/Version'), 403)
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('urgency_is_shared_binary: Urgent is shared without changing private focus', async ({
    admin,
    createUser,
  }) => {
    await install()
    try {
      const project = await sharedProject(admin)
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Confirm the customer deadline', project: project.row_id },
      })
      const member = await createUser({ roles: [] })
      await admin.put('/api/user_settings/Task%20Management%20Focus', { task_ids: [task.row_id] })
      await member.put('/api/user_settings/Task%20Management%20Focus', { task_ids: [] })

      await admin.post('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, urgent: true, updated_at: task.updated_at },
      })

      expect(await member.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({ urgent: true })
      expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({
        settings: { task_ids: [task.row_id] },
      })
      expect(await member.get('/api/user_settings/Task%20Management%20Focus')).toEqual({
        settings: { task_ids: [] },
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('focus_is_private_ordered: private focus settings', () => {
  test('one member’s focus is not returned to another member', async ({ admin, createUser }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Review the daybook import' },
      })
      const member = await createUser({ roles: [] })
      await member.put('/api/user_settings/Task%20Management%20Focus', {
        task_ids: [task.row_id],
      })

      expect(
        await member.get('/api/user_settings/Task%20Management%20Focus'),
      ).toEqual({ settings: { task_ids: [task.row_id] } })
      expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({
        settings: null,
      })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('A personal list decides who is responsible', () => {
  test('moving a task from someone’s personal list to a project takes it off them', async ({ admin, createUser }) => {
    await install()
    try {
      const shahul = await createUser({ roles: [] })
      const project = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: 'tasker.project', row: { project_name: 'Warehouse review' },
      })
      const task = await shahul.post<Record<string, unknown>>('/api/save_row', {
        table: TASK, row: { task_title: 'Count the 37 returned cartons', personal_tasks_owner: shahul.user },
      })
      expect(task).toMatchObject({ assigned_to: shahul.user })

      const moved = await shahul.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { row_id: task.row_id, updated_at: task.updated_at, project: project.row_id, personal_tasks_owner: null },
      })
      expect(moved).toMatchObject({ project: project.row_id, personal_tasks_owner: null, assigned_to: null })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('One responsible person', () => {
  test('handing a task from one teammate to another leaves only the new one responsible', async ({ admin, createUser }) => {
    await install()
    try {
      const shahul = await createUser({ roles: [] })
      const siraj = await createUser({ roles: [] })
      const project = await sharedProject(admin)
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK, row: { task_title: 'Phone the supplier about 11 missing crates', project: project.row_id, assigned_to: shahul.user },
      })
      const handed = await shahul.post<Record<string, unknown>>('/api/save_row', {
        table: TASK, row: { row_id: task.row_id, updated_at: task.updated_at, assigned_to: siraj.user },
      })
      expect(handed).toMatchObject({ assigned_to: siraj.user })
      const mine = await shahul.get<{ data: unknown[] }>(
        `/api/table/${TASK}?filters=${encodeURIComponent(JSON.stringify([['assigned_to', '=', shahul.user]]))}`,
      )
      expect(mine.data).toEqual([])
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('A newer change is never overwritten', () => {
  test('a save made from an older copy of the task is refused and the newer change stays', async ({ admin, createUser }) => {
    await install()
    try {
      const siraj = await createUser({ roles: [] })
      const shahul = await createUser({ roles: [] })
      const project = await sharedProject(admin)
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK, row: { task_title: 'Recount aisle 7', project: project.row_id },
      })
      // Both open the same copy; Shahul saves first.
      await shahul.post('/api/save_row', {
        table: TASK, row: { row_id: task.row_id, updated_at: task.updated_at, task_title: 'Recount aisle 7 and 8' },
      })
      await expect(siraj.post('/api/save_row', {
        table: TASK, row: { row_id: task.row_id, updated_at: task.updated_at, task_title: 'Recount aisle 9' },
      })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('modified after you loaded it') })
      expect(await admin.get(`/api/table/${TASK}/${task.row_id}`)).toMatchObject({ task_title: 'Recount aisle 7 and 8' })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})
