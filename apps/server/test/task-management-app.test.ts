import { describe, expect } from 'vitest'
import { test as base } from './pg-test'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { taskerClient } from './tasker-client'
import { installApp, isInstalled, uninstallApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { resolve } from 'node:path'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser(options))),
})

const APP = 'tasker'
const TASK = 'tasker.task'

async function install() {
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
}

// @spec capture_neutral_task.neutral_defaults
// @spec inbox_is_destination.captured_task_waits_in_inbox
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

// @spec one_task_destination.dual_destination_rejected
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

  // @spec personal_destination_assigns_owner.move_to_personal_tasks
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

// @spec completion_restores_state.undo_done_to_in_progress
describe('completion_restores_state: completion shortcut', () => {
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
        row: { row_id: done.row_id, updated_at: done.updated_at, task_state: 'Cancelled' },
      })
      expect(cancelled).toMatchObject({ task_state: 'Cancelled', is_done: false })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

// @spec assignment_state_independent.assign_not_started_task
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

  // @spec team_shares_tasker_work.unassigned_member_edits_task
  test('team_shares_tasker_work: a member can update a task without being assigned', async ({
    admin,
    createUser,
  }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Choose a warehouse count date' },
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
      await expect(member.get('/api/table/Version')).rejects.toMatchObject({ status: 403 })
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  // @spec urgency_is_shared_binary.urgent_without_focus
  test('urgency_is_shared_binary: Urgent is shared without changing private focus', async ({
    admin,
    createUser,
  }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: TASK,
        row: { task_title: 'Confirm the customer deadline' },
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
  // @spec focus_is_private_ordered
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
