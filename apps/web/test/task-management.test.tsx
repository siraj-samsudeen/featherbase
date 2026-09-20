import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { test, expect, renderApp } from './pg-test'

const APP = 'task-management'

async function install() {
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
}

test('TSK-J1 TSK-R1 TSK-R2: Enter captures a title-only task in Inbox', async ({ admin }) => {
  await install()
  try {
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    const capture = await screen.findByRole('textbox', { name: 'Quick capture' })
    await user.type(capture, 'Review September stock variance{Enter}')

    expect(await screen.findByText('Review September stock variance')).toBeInTheDocument()
    const rows = (await admin.get(
      '/api/table/Team%20Task?fields=%5B%22task_title%22%2C%22project%22%2C%22personal_tasks_owner%22%2C%22assigned_to%22%5D',
    )) as { data: Record<string, unknown>[] }
    await waitFor(() => expect(rows.data).toHaveLength(1))
    expect(rows.data[0]).toMatchObject({
      task_title: 'Review September stock variance',
      project: null,
      personal_tasks_owner: null,
      assigned_to: null,
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('TSK-J2 TSK-R4: a project accepts rapid unassigned task entry', async ({ admin }) => {
  await install()
  try {
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Projects' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Warehouse review{Enter}')
    const projectTask = await screen.findByRole('textbox', { name: 'Add task to project' })
    await user.type(projectTask, 'Compare September closing stock{Enter}')

    expect(await screen.findByText('Compare September closing stock')).toBeInTheDocument()
    const rows = (await admin.get(
      '/api/table/Team%20Task?fields=%5B%22task_title%22%2C%22project%22%2C%22assigned_to%22%5D',
    )) as { data: Record<string, unknown>[] }
    expect(rows.data[0]).toMatchObject({
      task_title: 'Compare September closing stock',
      assigned_to: null,
    })
    expect(rows.data[0].project).toBeTruthy()
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('TSK-J1 TSK-R3 TSK-I1: triage to Personal tasks assigns its owner', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'Team Task',
      row: { task_title: 'Prepare my weekly notes' },
    })) as { row_id: string }
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    const destination = await screen.findByRole('combobox', {
      name: 'Destination for Prepare my weekly notes',
    })
    await user.selectOptions(destination, 'personal:Administrator')

    await waitFor(() =>
      expect(screen.queryByText('Prepare my weekly notes')).not.toBeInTheDocument(),
    )
    const saved = (await admin.get(`/api/table/Team%20Task/${task.row_id}`)) as Record<string, unknown>
    expect(saved).toMatchObject({
      personal_tasks_owner: 'Administrator',
      assigned_to: 'Administrator',
      task_state: 'Not started',
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('TSK-J3 TSK-R9 TSK-R10 TSK-I3 TSK-H1: My Focus is ordered, private, and does not duplicate assigned work', async ({ admin }) => {
  await install()
  try {
    const assigned = (await admin.post('/api/save_row', {
      table: 'Team Task',
      row: { task_title: 'Assigned and focused', assigned_to: 'Administrator' },
    })) as { row_id: string }
    const focusedOnly = (await admin.post('/api/save_row', {
      table: 'Team Task',
      row: { task_title: 'Focused only' },
    })) as { row_id: string }
    await admin.put('/api/user_settings/Task%20Management%20Focus', {
      task_ids: ['TASK-does-not-exist'],
    })
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add to My Focus: Assigned and focused' }))
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Focused only' }))
    await user.click(screen.getByRole('button', { name: /My Work/ }))

    expect(await screen.findAllByText('Assigned and focused')).toHaveLength(1)
    expect(screen.getAllByText('Focused only')).toHaveLength(1)
    const settings = (await admin.get('/api/user_settings/Task%20Management%20Focus')) as {
      settings: { task_ids: string[] }
    }
    expect(settings.settings.task_ids).toEqual([assigned.row_id, focusedOnly.row_id])
    const rows = (await admin.get(
      '/api/table/Team%20Task?fields=%5B%22task_title%22%2C%22assigned_to%22%5D&order_by=task_title%20asc',
    )) as { data: Record<string, unknown>[] }
    expect(rows.data).toEqual([
      { task_title: 'Assigned and focused', assigned_to: 'Administrator' },
      { task_title: 'Focused only', assigned_to: null },
    ])
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('TSK-R7: an inactive state offers but does not require an explanation', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'Team Task',
      row: { task_title: 'Wait for stock ledger correction' },
    })) as { row_id: string }
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'State for Wait for stock ledger correction' }),
      'Blocked',
    )
    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    const state = await screen.findByRole('combobox', {
      name: 'State for Wait for stock ledger correction',
    })
    await waitFor(() => expect(state).toHaveValue('Blocked'))
    await user.selectOptions(state, 'On hold')
    const explanation = await screen.findByRole('textbox', { name: 'Optional explanation' })
    await user.type(explanation, 'Waiting for the warehouse team')
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(await screen.findByText('Waiting for the warehouse team')).toBeInTheDocument()

    await waitFor(async () => {
      const comments = (await admin.get(
        `/api/table/Comment?filters=${encodeURIComponent(JSON.stringify([['ref_name', '=', task.row_id]]))}&fields=%5B%22content%22%5D`,
      )) as { data: Record<string, unknown>[] }
      expect(comments.data).toEqual([{ content: 'Waiting for the warehouse team' }])
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('task rows offer one-click self-assignment', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'Team Task',
      row: { task_title: 'Own the stock follow-up' },
    })) as { row_id: string }
    await renderApp('/admin/home/tasks', admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Take it' }))

    await waitFor(async () => {
      const saved = (await admin.get(`/api/table/Team%20Task/${task.row_id}`)) as Record<string, unknown>
      expect(saved.assigned_to).toBe('Administrator')
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})
