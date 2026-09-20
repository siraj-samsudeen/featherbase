import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { installApp, isInstalled, registerApp, uninstallApp } from '../src/apps'
import taskManagement from '../src/sample-apps/task-management'

const APP = 'task-management'
const TASK = 'Team Task'

async function install() {
  registerApp(taskManagement)
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
}

describe('TSK-R1/TSK-R2: title-only Inbox capture', () => {
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

describe('TSK-R3: one destination', () => {
  test('a task cannot belong to both a project and Personal tasks', async ({ admin }) => {
    await install()
    try {
      const project = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: 'Team Project',
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

  test('moving to Personal tasks assigns that list owner', async ({ admin }) => {
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

describe('TSK-R6: completion shortcut', () => {
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

describe('TSK-R5: responsibility and work state are independent', () => {
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
  test('installation creates one Tasks Home Page, not a duplicate shortcut page', async ({
    admin,
  }) => {
    await install()
    try {
      const pages = await admin.get<{
        pages: { row_id: string; label: string; module: string | null }[]
      }>('/api/home_pages')
      expect(pages.pages.filter((page) => page.label === 'Tasks')).toEqual([
        expect.objectContaining({ row_id: 'tasks', module: 'Tasks' }),
      ])
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('a team member can read and update a task without being assigned', async ({
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
        '/api/table/Team%20Task?fields=%5B%22row_id%22%2C%22task_title%22%5D',
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
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('TSK-R9: private focus settings', () => {
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
