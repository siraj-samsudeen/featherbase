import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { sql } from 'server/src/db'
import { issueSession } from 'server/src/auth'
import { resolve } from 'node:path'
import { describe, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { peopleWithTaskResponsibility, TaskManagementPage } from '../../../runtime-apps/tasker/src/TaskManagement'
import { Markdown } from '../../../runtime-apps/tasker/src/Markdown'
import { setSession } from '../src/lib/api'
import { test as base, expect } from './pg-test'
import { taskerClient } from '../../server/test/tasker-client'

const test = base.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(taskerClient(admin)),
  createUser: async ({ createUser }, use) => use(async options => taskerClient(await createUser(options))),
})

const APP = 'tasker'

function renderTasker(as: TestClient) {
  if (!as.token || !as.user) throw new Error('Tasker fixture requires a signed-in user')
  setSession(as.token, { row_id: as.user, email: as.user, full_name: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={client}><TaskManagementPage /></QueryClientProvider>), client }
}

async function install() {
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
}

test('together_groups_active_responsibility: retains a person outside the fetched directory page', () => {
  expect(peopleWithTaskResponsibility(
    [{ row_id: 'first@example.test' }],
    [{ assigned_to: 'outside-page@example.test' }],
    'first@example.test',
  )).toEqual([
    { row_id: 'first@example.test' },
    { row_id: 'outside-page@example.test' },
  ])
})

test('quick_capture_flow: Enter captures a title-only task in Inbox', async ({ admin }) => {
  await install()
  try {
    renderTasker(admin)
    const user = userEvent.setup()

    const capture = await screen.findByRole('textbox', { name: 'Quick capture' })
    await user.type(capture, 'Review September stock variance{Enter}')

    expect(await screen.findByText('Review September stock variance')).toBeInTheDocument()
    await waitFor(() => expect(capture).toHaveValue(''))
    const rows = (await admin.get(
      '/api/table/tasker.task?fields=%5B%22task_title%22%2C%22project%22%2C%22personal_tasks_owner%22%2C%22assigned_to%22%5D',
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

test('an ended session refuses edits and restores private preferences without losing drafts', async ({ admin }) => {
  await install()
  const bridgedFetch = globalThis.fetch
  let release!: () => void
  const initialPreference = new Promise<void>(resolve => { release = resolve })
  try {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Retained work' } })
    const project = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Retained project' } })
    const session = await issueSession('Administrator')
    // Controls can render before this real preference read returns. Rollback
    // must restore the semantic default, not setQueryData(key, undefined).
    globalThis.fetch = async (input, init) => {
      const response = await bridgedFetch(input, init)
      if (init?.method === 'GET' && String(input).includes('/api/user_settings/Task%20Management%20Focus')) await initialPreference
      return response
    }
    renderTasker({ ...admin, token: session.token })
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'Retained work' })
    expect((await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })).status).toBe(200)

    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Retained work' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    expect(await screen.findByRole('button', { name: 'Add to My Focus: Retained work' })).toBeInTheDocument()
    expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: null })
    release()
    globalThis.fetch = bridgedFetch

    await user.click(screen.getByRole('button', { name: 'Save view' }))
    await user.type(screen.getByRole('textbox', { name: 'View name' }), 'Unsaved view')
    await user.click(screen.getByRole('button', { name: 'Save private view' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    expect(screen.getByRole('textbox', { name: 'View name' })).toHaveValue('Unsaved view')
    expect(await admin.get('/api/user_settings/tasker.saved-views')).toEqual({ settings: null })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Retained project' }))
    await user.click(screen.getByRole('button', { name: '☆ Add to tabs' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired session'))
    expect(await screen.findByRole('button', { name: '☆ Add to tabs' })).toBeInTheDocument()
    expect(await admin.get('/api/user_settings/tasker.projects')).toEqual({ settings: null })
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByRole('textbox', { name: 'Rename project' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), 'Unsaved project{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired session'))
    expect(screen.getByRole('textbox', { name: 'Rename project' })).toHaveValue('Unsaved project')
    expect(await admin.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ project_name: 'Retained project' })
    await user.click(screen.getByRole('button', { name: 'Projects' }))
    await user.type(screen.getByRole('textbox', { name: 'New project' }), 'Not created{Enter}')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired session'))
    expect(screen.getByRole('textbox', { name: 'New project' })).toHaveValue('Not created')
    expect((await admin.get('/api/table/tasker.project') as { data: unknown[] }).data).toHaveLength(1)

    setSession(admin.token!, { row_id: 'Administrator', email: 'Administrator', full_name: null })
    await user.click(screen.getByRole('button', { name: /^Inbox/ }))
    await user.click(screen.getByRole('link', { name: 'Retained work' }))
    await screen.findByRole('button', { name: 'Edit task' })
    setSession(session.token, { row_id: 'Administrator', email: 'Administrator', full_name: null })
    const details = within(screen.getByRole('region', { name: 'Task detail content' }))
    await user.click(details.getByRole('button', { name: 'Mark Done' }))
    expect(await details.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    expect(details.getByRole('combobox', { name: 'Task state' })).toHaveValue('Not started')
    await user.type(details.getByRole('textbox', { name: 'Add comment' }), 'Keep my draft{Enter}')
    expect(await details.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    expect(details.getByRole('textbox', { name: 'Add comment' })).toHaveValue('Keep my draft')
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ task_state: 'Not started', is_done: false })
    expect(await admin.get(`/api/activity/tasker.task/${task.row_id}`)).toMatchObject({ comments: [] })
    await user.click(details.getByRole('button', { name: 'Focus' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focused task details' })).not.toBeInTheDocument())
    expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual({ settings: null })
    setSession(admin.token!, { row_id: 'Administrator', email: 'Administrator', full_name: null })
    await user.click(screen.getByRole('button', { name: 'Focus' }))
    expect(await screen.findByRole('dialog', { name: 'Focused task details' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await waitFor(async () => expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual({ settings: { mode: 'focus' } }))
  } finally {
    release()
    globalThis.fetch = bridgedFetch
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test.for([true, false])('late preference rejection preserves a newer successful write: %s', async (newerSucceeds, { admin }) => {
  await install()
  const bridgedFetch = globalThis.fetch
  let release!: () => void
  const responseGate = new Promise<void>(resolve => { release = resolve })
  let received!: () => void
  const firstResponse = new Promise<void>(resolve => { received = resolve })
  try {
    const first = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'First preference' } })
    const second = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Second preference' } })
    const session = await issueSession('Administrator')
    renderTasker({ ...admin, token: session.token })
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'Second preference' })
    await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
    let delayed = false
    // Delay delivery of a genuine server refusal; do not fabricate a response.
    globalThis.fetch = async (input, init) => {
      const response = await bridgedFetch(input, init)
      if (!delayed && init?.method === 'PUT' && String(input).includes('/api/user_settings/Task%20Management%20Focus')) {
        delayed = true
        expect(response.status).toBe(401)
        received()
        await responseGate
      }
      return response
    }
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: First preference' }))
    await firstResponse
    if (newerSucceeds) setSession(admin.token!, { row_id: 'Administrator', email: 'Administrator', full_name: null })
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Second preference' }))
    release()
    if (newerSucceeds) {
      await waitFor(async () => expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: [first.row_id, second.row_id] } }))
    } else expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired session')
    for (const title of ['First preference', 'Second preference']) {
      expect(await screen.findByRole('button', { name: `${newerSucceeds ? 'Remove from' : 'Add to'} My Focus: ${title}` })).toBeInTheDocument()
    }
    if (!newerSucceeds) expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: null })
  } finally {
    release()
    globalThis.fetch = bridgedFetch
    await uninstallApp(APP).catch(() => {})
  }
})

test.for(['reverse writes', 'stale read'])('preference cache matches persisted truth after %s', async (race, { admin }) => {
  await install()
  const bridgedFetch = globalThis.fetch
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let held!: () => void
  const holding = new Promise<void>(resolve => { held = resolve })
  let delivered!: () => void
  const delivery = new Promise<void>(resolve => { delivered = resolve })
  try {
    const first = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Earlier choice' } })
    const second = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Later choice' } })
    const project = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Independent preference' } })
    let delayed = false
    globalThis.fetch = async (input, init) => {
      const target = String(input).includes('/api/user_settings/Task%20Management%20Focus')
      if (!delayed && target && init?.method === (race === 'reverse writes' ? 'PUT' : 'GET')) {
        delayed = true
        const stale = race === 'stale read' ? await bridgedFetch(input, init) : null
        held()
        await gate
        const response = stale ?? await bridgedFetch(input, init)
        delivered()
        return response
      }
      return bridgedFetch(input, init)
    }
    const { client } = renderTasker(admin)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'Earlier choice' })
    if (race === 'stale read') await holding
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Earlier choice' }))
    if (race === 'reverse writes') {
      await holding
      await user.click(screen.getByRole('button', { name: 'Add to My Focus: Later choice' }))
      expect(screen.getByRole('button', { name: 'Remove from My Focus: Later choice' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Independent preference' }))
      await user.click(screen.getByRole('button', { name: '☆ Add to tabs' }))
      await waitFor(async () => expect(await admin.get('/api/user_settings/tasker.projects')).toEqual({ settings: { project_ids: [project.row_id] } }))
      await user.click(screen.getByRole('button', { name: /^Inbox/ }))
    } else {
      await waitFor(async () => expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: [first.row_id] } }))
    }
    release()
    await delivery
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from My Focus: Earlier choice' })).toBeInTheDocument())
    const ids = race === 'reverse writes' ? [first.row_id, second.row_id] : [first.row_id]
    await waitFor(async () => expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: ids } }))
    expect(await screen.findByRole('button', { name: `${race === 'reverse writes' ? 'Remove from' : 'Add to'} My Focus: Later choice` })).toBeInTheDocument()
  } finally {
    release()
    globalThis.fetch = bridgedFetch
    await uninstallApp(APP).catch(() => {})
  }
})

test('a lost preference response refetches the committed value instead of rolling it back', async ({ admin }) => {
  await install()
  const bridgedFetch = globalThis.fetch
  try {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Confirmed by refetch' } })
    renderTasker(admin)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'Confirmed by refetch' })
    globalThis.fetch = async (input, init) => {
      const response = await bridgedFetch(input, init)
      if (init?.method === 'PUT' && String(input).includes('/api/user_settings/Task%20Management%20Focus')) {
        expect(response.status).toBe(200)
        throw new TypeError('Connection lost after the server committed')
      }
      return response
    }
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Confirmed by refetch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update My Focus')
    expect(screen.getByRole('button', { name: 'Remove from My Focus: Confirmed by refetch' })).toBeInTheDocument()
    expect(await admin.get('/api/user_settings/Task%20Management%20Focus')).toEqual({ settings: { task_ids: [task.row_id] } })
  } finally {
    globalThis.fetch = bridgedFetch
    await uninstallApp(APP).catch(() => {})
  }
})

test('lightweight_project_entry: a project accepts rapid unassigned task entry', async ({ admin }) => {
  await install()
  try {
    renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Projects' }))
    await user.type(screen.getByRole('textbox', { name: 'New project' }), 'Warehouse review{Enter}')
    const projectTask = await screen.findByRole('textbox', { name: 'Add task to project' })
    const titles = [
      'Compare September closing stock',
      'Confirm warehouse count date',
      'Review damaged stock notes',
    ]
    await user.type(projectTask, titles[0])
    expect(projectTask.closest('form')?.querySelector('button[type="submit"], button:not([type])')).toBeEnabled()
    await user.type(projectTask, '{Enter}')
    expect(await screen.findByText(titles[0])).toBeInTheDocument()
    expect(projectTask).toHaveFocus()
    for (const title of titles.slice(1)) {
      await user.type(projectTask, `${title}{Enter}`)
      expect(await screen.findByText(title)).toBeInTheDocument()
      expect(projectTask).toHaveFocus()
    }

    const rows = (await admin.get(
      '/api/table/tasker.task?fields=%5B%22task_title%22%2C%22project%22%2C%22assigned_to%22%5D',
    )) as { data: Record<string, unknown>[] }
    expect(rows.data).toHaveLength(3)
    expect(rows.data.map((row) => row.task_title).sort()).toEqual([...titles].sort())
    expect(rows.data.every((row) => row.assigned_to === null && Boolean(row.project))).toBe(true)
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('projects_landing_flow: the directory opens a project and keeps its context behind task details', async ({ admin }) => {
  await install()
  try {
    renderTasker(admin)
    const user = userEvent.setup()

    const navigation = await screen.findByRole('navigation', { name: 'Task views' })
    expect(Array.from(navigation.querySelectorAll(':scope > button')).map((button) => button.textContent?.replace(/\d+$/, ''))).toEqual([
      'Inbox', 'My Work', 'Together', 'Personal tasks', 'Views', 'Projects',
    ])
    await user.click(await screen.findByRole('button', { name: 'Projects' }))
    await user.type(screen.getByRole('textbox', { name: 'New project' }), 'Warehouse review{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Add task to project' }), 'Count closing stock{Enter}')
    await user.click(screen.getByRole('button', { name: 'Projects' }))
    await user.type(screen.getByRole('textbox', { name: 'New project' }), 'Store opening readiness{Enter}')
    expect(await screen.findByRole('heading', { name: 'Store opening readiness' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Projects' }))

    expect(screen.getByRole('textbox', { name: 'New project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open project Warehouse review' })).toHaveTextContent('1 task')
    expect(screen.getByRole('button', { name: 'Open project Store opening readiness' })).toHaveTextContent('0 tasks')
    expect(screen.getByRole('button', { name: 'Warehouse review' })).toHaveTextContent('1')
    expect(screen.queryByRole('button', { name: /star project/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open project Warehouse review' }))
    expect(await screen.findByRole('heading', { name: 'Warehouse review' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Count closing stock' }))
    expect(await screen.findByRole('complementary', { name: 'Task details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Warehouse review' })).toBeInTheDocument()
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('find_and_reuse_task_view: compound project criteria stay visible and save privately without changing tasks', async ({ admin, createUser }) => {
  await install()
  try {
    const member = await createUser({ roles: [] })
    const stockProject = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'September stock review' },
    })
    const otherProject = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'Store opening readiness' },
    })
    const matching = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: {
        task_title: 'Reconcile receiving variance',
        description: 'Check the warehouse transfer evidence.',
        project: stockProject.row_id,
        assigned_to: member.user,
        task_state: 'Not started',
        urgent: true,
      },
    })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Book the count date', project: stockProject.row_id,
      assigned_to: member.user, task_state: 'In progress', urgent: false,
    } })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Escalate damaged stock', project: stockProject.row_id,
      assigned_to: 'Administrator', task_state: 'Blocked', urgent: true,
    } })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Review another warehouse transfer',
      description: 'The same search words are outside this project.',
      project: otherProject.row_id,
      assigned_to: member.user,
      task_state: 'Not started',
      urgent: true,
    } })
    const taskBefore = await admin.get(`/api/table/tasker.task/${matching.row_id}`)

    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Projects' }))
    await user.click(await screen.findByRole('button', { name: 'September stock review' }))

    const search = await screen.findByRole('searchbox', { name: 'Search task titles and descriptions' })
    await user.type(search, 'warehouse transfer')
    expect(await screen.findByText('Reconcile receiving variance')).toBeInTheDocument()
    expect(screen.queryByText('Review another warehouse transfer')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument()
    await user.clear(search)

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('checkbox', { name: 'Not started' }))
    await user.click(screen.getByRole('checkbox', { name: 'In progress' }))
    await user.click(screen.getByRole('checkbox', { name: member.user! }))
    await user.click(screen.getByRole('checkbox', { name: 'Urgent' }))
    await user.click(screen.getAllByRole('button', { name: 'Close filters' }).at(-1)!)

    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Not started filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove In progress filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Remove ${member.user} filter` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Urgent filter' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save view' }))
    await user.type(screen.getByRole('textbox', { name: 'View name' }), 'Discarded view')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await admin.get('/api/user_settings/tasker.saved-views')).toEqual({ settings: null })
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    await user.type(screen.getByRole('textbox', { name: 'View name' }), 'Urgent open stock work')
    await user.click(screen.getByRole('button', { name: 'Save private view' }))
    expect(await screen.findByRole('heading', { name: 'Urgent open stock work' })).toBeInTheDocument()
    const stored = await admin.get('/api/user_settings/tasker.saved-views') as {
      settings: { views: { id: string; name: string; scope: { kind: string; projectId?: string } }[] }
    }
    expect(stored.settings.views).toHaveLength(1)
    expect(stored.settings.views[0]).toMatchObject({
      name: 'Urgent open stock work',
      scope: { kind: 'project', projectId: stockProject.row_id },
    })
    expect(location.hash).toBe(`#view=${stored.settings.views[0].id}`)
    expect(await member.get('/api/user_settings/tasker.saved-views')).toEqual({ settings: null })
    expect(await admin.get(`/api/table/tasker.task/${matching.row_id}`)).toEqual(taskBefore)

    await user.click(screen.getByRole('button', { name: 'Filter (4)' }))
    await user.click(screen.getByRole('checkbox', { name: 'Blocked' }))
    await user.click(screen.getAllByRole('button', { name: 'Close filters' }).at(-1)!)
    expect(screen.getByRole('button', { name: 'Update view' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByRole('button', { name: 'Remove Blocked filter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update view' })).not.toBeInTheDocument()

    const savedViewSearch = screen.getByRole('searchbox', { name: 'Search task titles and descriptions' })
    await user.type(savedViewSearch, 'does not exist')
    expect(await screen.findByText('No tasks match this search and filters')).toBeInTheDocument()
    expect(screen.getAllByText('0 of 3 tasks').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Remove Urgent filter' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await screen.findByText('Reconcile receiving variance')).toBeInTheDocument()
    await user.type(savedViewSearch, 'does not exist')
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(screen.queryByRole('button', { name: 'Remove Urgent filter' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('does not exist')
    expect((await admin.get('/api/user_settings/tasker.saved-views') as typeof stored).settings.views).toEqual(stored.settings.views)

    await user.click(screen.getByRole('button', { name: /Views/ }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename saved view' }), ' discarded')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Urgent open stock work')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const rename = screen.getByRole('textbox', { name: 'Rename saved view' })
    await user.clear(rename)
    await user.type(rename, 'September urgent work')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('September urgent work')).toBeInTheDocument()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    confirm.mockRestore()
    await waitFor(async () => expect(await admin.get('/api/user_settings/tasker.saved-views')).toEqual({
      settings: { views: [] },
    }))
    expect(await admin.get(`/api/table/tasker.task/${matching.row_id}`)).toEqual(taskBefore)
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('personal_destination_assigns_owner: Inbox work moved to Personal tasks assigns its owner', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Prepare my weekly notes' },
    })) as { row_id: string }
    renderTasker(admin)
    const user = userEvent.setup()

    const destination = await screen.findByRole('combobox', {
      name: 'Destination for Prepare my weekly notes',
    })
    await user.selectOptions(destination, 'personal:Administrator')

    await waitFor(() =>
      expect(screen.queryByText('Prepare my weekly notes')).not.toBeInTheDocument(),
    )
    const saved = (await admin.get(`/api/table/tasker.task/${task.row_id}`)) as Record<string, unknown>
    expect(saved).toMatchObject({
      personal_tasks_owner: 'Administrator',
      assigned_to: 'Administrator',
      task_state: 'Not started',
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('personal_worklist_flow: My Focus is ordered, private, and does not duplicate assigned work', async ({ admin, createUser }) => {
  await install()
  try {
    const assigned = (await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Assigned and focused', assigned_to: 'Administrator' },
    })) as { row_id: string }
    const focusedOnly = (await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Focused only' },
    })) as { row_id: string }
    const member = await createUser({ roles: [] })
    await member.put('/api/user_settings/Task%20Management%20Focus', {
      task_ids: [focusedOnly.row_id],
    })
    await admin.put('/api/user_settings/Task%20Management%20Focus', {
      task_ids: ['TASK-does-not-exist'],
    })
    const rendered = renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add to My Focus: Assigned and focused' }))
    await user.click(screen.getByRole('button', { name: 'Add to My Focus: Focused only' }))
    await user.click(screen.getByRole('button', { name: /My Work/ }))
    await user.click(screen.getByRole('button', { name: 'Move Focused only up' }))

    expect(await screen.findAllByText('Assigned and focused')).toHaveLength(1)
    expect(screen.getAllByText('Focused only')).toHaveLength(1)
    const settings = (await admin.get('/api/user_settings/Task%20Management%20Focus')) as {
      settings: { task_ids: string[] }
    }
    expect(settings.settings.task_ids).toEqual([focusedOnly.row_id, assigned.row_id])
    expect(await member.get('/api/user_settings/Task%20Management%20Focus')).toEqual({
      settings: { task_ids: [focusedOnly.row_id] },
    })
    rendered.unmount()
    renderTasker(admin)
    await user.click(await screen.findByRole('button', { name: /My Work/ }))
    const cards = await screen.findAllByRole('article')
    expect(cards[0]).toHaveTextContent('Focused only')
    expect(cards[1]).toHaveTextContent('Assigned and focused')
    const rows = (await admin.get(
      '/api/table/tasker.task?fields=%5B%22task_title%22%2C%22assigned_to%22%5D&order_by=task_title%20asc',
    )) as { data: Record<string, unknown>[] }
    expect(rows.data).toEqual([
      { task_title: 'Assigned and focused', assigned_to: 'Administrator' },
      { task_title: 'Focused only', assigned_to: null },
    ])
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('discussion_stays_append_only: an inactive state offers but does not require an explanation', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Wait for stock ledger correction' },
    })) as { row_id: string }
    renderTasker(admin)
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

test('assignment_state_independent: task rows offer one-click self-assignment', async ({ admin }) => {
  await install()
  try {
    const task = (await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Own the stock follow-up' },
    })) as { row_id: string }
    renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Take it' }))

    await waitFor(async () => {
      const saved = (await admin.get(`/api/table/tasker.task/${task.row_id}`)) as Record<string, unknown>
      expect(saved.assigned_to).toBe('Administrator')
    })
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

test('project_coordination_flow: rename, private tabs, and Together retain their separate rules', async ({ admin, createUser }) => {
  await install()
  try {
    const first = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'September stock review' },
    })
    const second = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'Store opening readiness' },
    })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Reconcile receiving variance', project: first.row_id, assigned_to: 'Administrator',
    } })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Choose the count date', project: first.row_id,
    } })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      task_title: 'Archive finished checklist', project: second.row_id, task_state: 'Done',
    } })
    const member = await createUser({ roles: [] })
    renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Projects' }))
    await user.click(await screen.findByRole('button', { name: 'September stock review' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByRole('textbox', { name: 'Rename project' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), 'Stock review — September{Enter}')
    expect(await screen.findByRole('heading', { name: 'Stock review — September' })).toBeInTheDocument()
    expect(screen.getByText('Reconcile receiving variance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '☆ Add to tabs' }))
    await user.click(screen.getByRole('button', { name: 'Store opening readiness' }))
    await user.click(screen.getByRole('button', { name: '☆ Add to tabs' }))
    await user.click(screen.getByRole('button', { name: 'Move project Store opening readiness tab left' }))
    await waitFor(async () => expect(await admin.get('/api/user_settings/tasker.projects')).toEqual({
      settings: { project_ids: [second.row_id, first.row_id] },
    }))
    expect(await member.get('/api/user_settings/tasker.projects')).toEqual({ settings: null })
    await user.click(within(document.querySelector('.tasker-project-tabs') as HTMLElement).getByRole('button', { name: 'Stock review — September' }))
    expect(await screen.findByRole('heading', { name: 'Stock review — September' })).toBeInTheDocument()
    expect(screen.getByText('Reconcile receiving variance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Together' }))
    expect(await screen.findByRole('heading', { name: /Unassigned 1/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Administrator 1/ })).toBeInTheDocument()
    expect(screen.getByText('Choose the count date')).toBeInTheDocument()
    expect(screen.getByText('Reconcile receiving variance')).toBeInTheDocument()
    expect(screen.queryByText('Archive finished checklist')).not.toBeInTheDocument()
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('project_rename_conflict: a refreshed project cannot rebase an unsaved rename', async ({ admin, createUser }) => {
  await install()
  try {
    const project = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'Original project' },
    })
    const teammate = await createUser({ roles: [] })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Original project' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByRole('textbox', { name: 'Rename project' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), 'My unsaved name')

    await teammate.post('/api/save_row', { table: 'tasker.project', row: {
      row_id: project.row_id, project_name: 'Teammate saved name', updated_at: project.updated_at,
    } })
    // A real list mutation refetches projects. The sidebar proves it has rendered.
    await user.type(screen.getByRole('textbox', { name: 'Add task to project' }), 'Refresh project{Enter}')
    expect(await screen.findByRole('button', { name: 'Teammate saved name' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), ' revised')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/modified|changed|conflict/i)
    expect(screen.getByRole('textbox', { name: 'Rename project' })).toHaveValue('My unsaved name revised')
    expect(await admin.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({
      project_name: 'Teammate saved name',
    })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Teammate saved name' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Rename project' })).toHaveValue('Teammate saved name')
    await user.clear(screen.getByRole('textbox', { name: 'Rename project' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), 'Agreed name{Enter}')
    expect(await screen.findByRole('heading', { name: 'Agreed name' })).toBeInTheDocument()
    expect(await admin.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({
      project_name: 'Agreed name',
    })
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('project_rename_navigation: switching projects discards the previous rename draft', async ({ admin }) => {
  await install()
  try {
    const first = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'First project' },
    })
    const second = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.project', row: { project_name: 'Second project' },
    })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'First project' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), ' abandoned')
    await user.click(screen.getByRole('button', { name: 'Second project' }))
    expect(await screen.findByRole('heading', { name: 'Second project' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Rename project' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('textbox', { name: 'Rename project' })).toHaveValue('Second project')
    await user.type(screen.getByRole('textbox', { name: 'Rename project' }), ' renamed{Enter}')
    expect(await screen.findByRole('heading', { name: 'Second project renamed' })).toBeInTheDocument()
    expect(await admin.get(`/api/table/tasker.project/${second.row_id}`)).toMatchObject({ project_name: 'Second project renamed' })
    await user.click(screen.getByRole('button', { name: 'First project' }))
    expect(await screen.findByRole('heading', { name: 'First project' })).toBeInTheDocument()
    expect(await admin.get(`/api/table/tasker.project/${first.row_id}`)).toMatchObject({ project_name: 'First project' })
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('markdown_safety: links lists and code render but HTML and unsafe URLs remain inert', () => {
  const { container } = render(<Markdown>{'- First\n- Second\n\n[Safe](https://example.test) [Unsafe](javascript:alert(1))\n\n`inline`\n\n```js\nconst n = 3\n```\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.test"></iframe>'}</Markdown>)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('href', 'https://example.test')
  expect(container.querySelector('pre code')).toHaveTextContent('const n = 3')
  expect(container.querySelector('script, iframe, img, [onerror]')).toBeNull()
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
})

test('project_description_flow: explicit editing cancel save clear and a second member see shared context', async ({ admin, createUser }) => {
  await install()
  try {
    const project = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Shared context' } })
    const other = await createUser({ roles: [] })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Shared context' }))
    await user.click(await screen.findByRole('button', { name: 'Add description' }))
    const region = within(screen.getByRole('region', { name: 'Project description' }))
    await user.type(region.getByRole('textbox'), 'Discard this')
    await user.click(region.getByRole('button', { name: 'Cancel' }))
    expect(await admin.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ description: null })
    await user.click(region.getByRole('button', { name: 'Add description' }))
    await user.type(region.getByRole('textbox'), '- Report one observation\n- Include evidence')
    await user.click(region.getByRole('button', { name: 'Save description' }))
    expect(await region.findByText('Report one observation')).toBeInTheDocument()
    expect(await other.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ description: '- Report one observation\n- Include evidence' })
    await user.click(region.getByRole('button', { name: 'Edit description' }))
    await user.clear(region.getByRole('textbox'))
    await user.click(region.getByRole('button', { name: 'Save description' }))
    expect(await region.findByRole('button', { name: 'Add description' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Add task to project' })).toBeInTheDocument()
  } finally { await uninstallApp(APP).catch(() => {}) }
})

test('project_description_conflict: competing project edit is not overwritten', async ({ admin }) => {
  await install()
  try {
    const project = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Conflicting context' } })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Conflicting context' }))
    await user.click(await screen.findByRole('button', { name: 'Add description' }))
    const region = within(screen.getByRole('region', { name: 'Project description' }))
    await user.type(region.getByRole('textbox'), 'My draft')
    await admin.post('/api/save_row', { table: 'tasker.project', row: { row_id: project.row_id, updated_at: project.updated_at, description: 'Their description' } })
    await user.click(region.getByRole('button', { name: 'Save description' }))
    expect(await region.findByRole('alert')).toHaveTextContent(/modified|changed|conflict/i)
    expect(region.getByRole('textbox')).toHaveValue('My draft')
    expect(await admin.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ description: 'Their description' })
  } finally { await uninstallApp(APP).catch(() => {}) }
})

test('take_membership: Take persists responsibility into My Work, not the Personal destination', async ({ admin, createUser }) => {
  await install()
  try {
    const member = await createUser({ roles: [] })
    const task = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Take membership probe', task_state: 'Blocked', urgent: true } })
    renderTasker(member)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Take membership probe' }))
    await user.click(screen.getByRole('button', { name: 'Focus' }))
    const detail = within(await screen.findByRole('dialog', { name: 'Focused task details' }))
    await user.click(await detail.findByRole('button', { name: 'Take it' }))
    await waitFor(() => expect(detail.getByRole('combobox', { name: 'Task responsibility' })).toHaveValue(member.user))
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ assigned_to: member.user, task_state: 'Blocked', urgent: true, personal_tasks_owner: null })
    await user.click(detail.getByRole('link', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: /My Work/ }))
    expect(await screen.findByRole('link', { name: 'Take membership probe' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Personal tasks/ }))
    expect(screen.queryByRole('link', { name: 'Take membership probe' })).not.toBeInTheDocument()
  } finally { location.hash = ''; await uninstallApp(APP).catch(() => {}) }
})

test('task_correction_flow: save and cancel correct the title and permit an empty description', async ({ admin }) => {
  await install()
  try {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: { task_title: 'Wrong warehouse', description: 'Old scope' },
    })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Wrong warehouse' }))
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Edit task' }))
    let title = await screen.findByRole('textbox', { name: 'Task title' })
    await user.clear(title)
    expect(screen.getByRole('button', { name: 'Save task' })).toBeDisabled()
    await user.type(title, 'Discard this draft')
    await user.click(screen.getByRole('button', { name: 'Cancel changes' }))
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit task' }))
    title = screen.getByRole('textbox', { name: 'Task title' })
    expect(title).toHaveValue('Wrong warehouse')
    await user.clear(title)
    await user.type(title, 'Correct warehouse')
    await user.clear(screen.getByRole('textbox', { name: 'Description' }))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(await screen.findByRole('link', { name: 'Correct warehouse' })).toBeInTheDocument()
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ task_title: 'Correct warehouse', description: null })
    await waitFor(() => expect(screen.getByTestId('task-activity')).toHaveTextContent('task title: Wrong warehouse → Correct warehouse'))
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('task_correction_conflict: a background refresh cannot rebase an unsaved draft', async ({ admin }) => {
  await install()
  try {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: { task_title: 'Concurrent task', description: 'Original' },
    })
    renderTasker(admin)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Concurrent task' }))
    await user.click(await screen.findByRole('button', { name: 'Edit task' }))
    await user.type(await screen.findByRole('textbox', { name: 'Task title' }), ' draft')
    await admin.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, description: 'Another editor', updated_at: task.updated_at } })
    // List mutation refreshes all detail queries while the draft is still open.
    await user.type(screen.getByRole('textbox', { name: 'Quick capture' }), 'Refresh trigger{Enter}')
    await screen.findByRole('link', { name: 'Refresh trigger' })
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/modified|changed|conflict/i)
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Concurrent task draft')
    expect(await admin.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ task_title: 'Concurrent task', description: 'Another editor' })
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('task_detail_flow: one task switches among three detail modes with comments and history', async ({ admin }) => {
  await install()
  try {
    const task = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'tasker.task', row: { task_title: 'Confirm the warehouse count', description: 'Confirm scope and date.' },
    })
    await admin.post('/api/save_row', { table: 'tasker.task', row: {
      row_id: task.row_id, updated_at: task.updated_at, urgent: true,
    } })
    await admin.post('/api/save_row', { table: 'Comment', row: {
      ref_table: 'tasker.task', ref_name: task.row_id, content: 'Warehouse lead is checking the roster.',
    } })
    renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Confirm the warehouse count' }))
    expect(await screen.findByRole('complementary', { name: 'Task details' })).toBeInTheDocument()
    expect(await screen.findByText('Warehouse lead is checking the roster.')).toBeInTheDocument()
    expect(screen.getByTestId('task-activity')).toHaveTextContent('urgent: false → true')
    await user.type(screen.getByRole('textbox', { name: 'Add comment' }), 'Count is now booked for Friday.')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(await screen.findByText('Count is now booked for Friday.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Focus' }))
    expect(await screen.findByRole('dialog', { name: 'Focused task details' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    expect(await screen.findByRole('region', { name: 'Task detail content' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Focused task details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Add comment' })).not.toBeInTheDocument()
    expect(screen.getByText('Open Inspector to edit or join the discussion.')).toBeInTheDocument()
    expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual({ settings: { mode: 'compact' } })
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

// "Switch layouts without losing the task" (tasker-use-task-details). The UI
// names the layouts Inspector (side panel), Focus (full page) and Compact
// (summary).
test('switching side panel → full page → summary keeps the same task open, and after a reload tasks open in the summary', async ({ admin }) => {
  await install()
  try {
    await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Recount the shoe aisle', description: 'Two bins disagree.' } })
    await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Order more hangers' } })
    const first = renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Recount the shoe aisle' }))
    const panel = await screen.findByRole('complementary', { name: 'Task details' })
    expect(await within(panel).findByRole('heading', { name: 'Recount the shoe aisle' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Focus' }))
    const page = await screen.findByRole('dialog', { name: 'Focused task details' })
    expect(await within(page).findByRole('heading', { name: 'Recount the shoe aisle' })).toBeInTheDocument()

    await user.click(within(page).getByRole('button', { name: 'Compact' }))
    const summary = await screen.findByRole('region', { name: 'Task detail content' })
    expect(await within(summary).findByRole('heading', { name: 'Recount the shoe aisle' })).toBeInTheDocument()
    expect(within(summary).getByText('Two bins disagree.')).toBeInTheDocument()
    await waitFor(async () => expect(await admin.get('/api/user_settings/tasker.preferences')).toEqual({ settings: { mode: 'compact' } }))

    // A reload: a fresh page with nothing cached, and no task open.
    first.unmount()
    location.hash = ''
    renderTasker(admin)
    await user.click(await screen.findByRole('link', { name: 'Order more hangers' }))
    const reopened = await screen.findByRole('region', { name: 'Task detail content' })
    expect(await within(reopened).findByRole('heading', { name: 'Order more hangers' })).toBeInTheDocument()
    expect(within(reopened).getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('complementary', { name: 'Task details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Focused task details' })).not.toBeInTheDocument()
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

// "See a comment and a change" (tasker-use-task-details): both made in the
// task details by a person with a name.
async function commentAndMarkUrgent(as: TestClient, title: string) {
  renderTasker(as)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('link', { name: title }))
  const panel = await screen.findByRole('complementary', { name: 'Task details' })
  await user.type(await within(panel).findByRole('textbox', { name: 'Add comment' }), 'Called the supplier')
  await user.click(within(panel).getByRole('button', { name: 'Comment' }))
  await within(panel).findByText('Called the supplier')
  // The details stay disabled until every refresh after the comment
  // settles; a click before then is ignored.
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Not urgent' })).toBeEnabled())
  await user.click(within(panel).getByRole('button', { name: 'Not urgent' }))
  await waitFor(() => expect(within(panel).getByTestId('task-activity')).toHaveTextContent('urgent: false → true'))
  const entries = within(within(panel).getByTestId('task-activity')).getAllByRole('listitem')
    .filter((li) => li.parentElement === within(panel).getByTestId('task-activity'))
  const comment = entries.find((li) => li.textContent?.includes('Called the supplier'))!
  const change = entries.find((li) => li.textContent?.includes('urgent: false → true'))!
  return { comment, change }
}

test('a comment and a change made in the task details each show when they were made', async ({ admin, createUser }) => {
  await install()
  try {
    const rani = await createUser({ roles: [], fullName: 'Rani Storekeeper' })
    await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Chase the late delivery', assigned_to: rani.user } })
    const { comment, change } = await commentAndMarkUrgent(rani, 'Chase the late delivery')
    // The time each was made (any locale prints hours and minutes as h:mm).
    expect(comment).toHaveTextContent(/commented · .*\d{1,2}:\d{2}/)
    expect(change).toHaveTextContent(/edited · .*\d{1,2}:\d{2}/)
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

// SPEC: Discussion and history stay in Tasker — "each with the user's name and
// the time" — suspected defect: the entries name their author by the Person's
// row id (`created_by`, a minted psn_… id for anyone but Administrator), not
// by the person's name.
test.fails('a comment and a change made in the task details each show the name of the person who made them', async ({ admin, createUser }) => {
  await install()
  try {
    const rani = await createUser({ roles: [], fullName: 'Rani Storekeeper' })
    await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Chase the late delivery', assigned_to: rani.user } })
    const { comment, change } = await commentAndMarkUrgent(rani, 'Chase the late delivery')
    expect(comment).toHaveTextContent('Rani Storekeeper commented')
    expect(change).toHaveTextContent('Rani Storekeeper edited')
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('task details do not carry unsaved text into another task', async ({ admin }) => {
  await install()
  try {
    await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'First task', description: 'First description' },
    })
    await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Second task', description: 'Second description' },
    })
    renderTasker(admin)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'First task' }))
    await user.click(await screen.findByRole('button', { name: 'Edit task' }))
    const firstDescription = await screen.findByRole('textbox', { name: 'Description' })
    await user.clear(firstDescription)
    await user.type(firstDescription, 'Unsaved first-task draft')
    await user.type(screen.getByRole('textbox', { name: 'Add comment' }), 'Unsaved first-task comment')

    await user.click(screen.getByRole('link', { name: 'Second task' }))

    await screen.findByText('Second description')
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Add comment' })).toHaveValue('')
  } finally {
    location.hash = ''
    await uninstallApp(APP).catch(() => {})
  }
})

test('task_list_surface: every task row exposes the same shared and private controls', async ({ admin }) => {
  await install()
  try {
    await admin.post('/api/save_row', {
      table: 'tasker.task',
      row: { task_title: 'Review blocked transfer', task_state: 'Blocked', urgent: true },
    })
    renderTasker(admin)

    expect(await screen.findByRole('combobox', { name: 'State for Review blocked transfer' })).toHaveValue('Blocked')
    expect(screen.getByRole('combobox', { name: 'Destination for Review blocked transfer' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Assign Review blocked transfer' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Remove urgent flag from Review blocked transfer' })).toHaveTextContent('Urgent')
    expect(screen.getByRole('button', { name: 'Add to My Focus: Review blocked transfer' })).toBeInTheDocument()
  } finally {
    await uninstallApp(APP).catch(() => {})
  }
})

describe('What the Inbox holds and where a task lives', () => {
  test('moving an Inbox task into a project takes it out of the Inbox and into that project', async ({ admin }) => {
    await install()
    try {
      const project = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: 'tasker.project', row: { project_name: 'Warehouse review' },
      })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Order packing tape' } })
      renderTasker(admin)
      const user = userEvent.setup()

      const destination = await screen.findByRole('combobox', { name: 'Destination for Order packing tape' })
      await within(destination).findByRole('option', { name: 'Warehouse review' })
      await user.selectOptions(destination, `project:${project.row_id}`)
      await waitFor(() => expect(screen.queryByText('Order packing tape')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Warehouse review' }))
      expect(await screen.findByRole('heading', { name: 'Warehouse review' })).toBeInTheDocument()
      expect(await screen.findByText('Order packing tape')).toBeInTheDocument()
    } finally {
      location.hash = ''
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Missing tasks drop out of My Focus', () => {
  test('when the middle of three focused tasks is deleted, My Work keeps the other two in order', async ({ admin }) => {
    await install()
    try {
      const titles = ['First focused count', 'Middle focused count', 'Last focused count']
      const created: Record<string, unknown>[] = []
      for (const task_title of titles)
        created.push(await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.task', row: { task_title } }))
      await admin.put('/api/user_settings/Task%20Management%20Focus', { task_ids: created.map((task) => task.row_id) })
      await admin.delete(`/api/table/tasker.task/${created[1].row_id}?updated_at=${encodeURIComponent(String(created[1].updated_at))}`)

      renderTasker(admin)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: /My Work/ }))
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
      const cards = screen.getAllByRole('article')
      expect(cards[0]).toHaveTextContent('First focused count')
      expect(cards[1]).toHaveTextContent('Last focused count')
      expect(screen.queryByText('Middle focused count')).not.toBeInTheDocument()
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Tabs for missing projects disappear', () => {
  test('when the middle of three starred projects is deleted, the other two tabs keep their order', async ({ admin }) => {
    await install()
    try {
      const names = ['Store opening', 'Stock review', 'Warehouse review']
      const projects: Record<string, unknown>[] = []
      for (const project_name of names)
        projects.push(await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name } }))
      await admin.put('/api/user_settings/tasker.projects', { project_ids: projects.map((project) => project.row_id) })
      await admin.delete(`/api/table/tasker.project/${projects[1].row_id}?updated_at=${encodeURIComponent(String(projects[1].updated_at))}`)

      const { container } = renderTasker(admin)
      await screen.findAllByRole('button', { name: 'Warehouse review' }, { timeout: 5000 })
      const tabs = await waitFor(() => {
        const element = container.querySelector('[aria-label="Starred projects"]')
        expect(element).not.toBeNull()
        return element as HTMLElement
      })
      expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['Store opening', 'Warehouse review'])
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Saved views stay within their list', () => {
  test('a view saved for one project never shows matching tasks from another project', async ({ admin }) => {
    await install()
    try {
      const stock = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'September stock review' } })
      const opening = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Store opening readiness' } })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Recount 37 urgent cartons', project: stock.row_id, urgent: true } })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Urgent signage for opening', project: opening.row_id, urgent: true } })
      await admin.put('/api/user_settings/tasker.saved-views', { views: [{
        id: 'stock-urgent', name: 'Urgent stock work', scope: { kind: 'project', projectId: stock.row_id },
        setup: { search: '', filters: { states: [], responsiblePeople: [], urgencies: ['urgent'], projects: [] } },
      }] })
      location.hash = '#view=stock-urgent'
      renderTasker(admin)

      expect(await screen.findByRole('heading', { name: 'Urgent stock work' })).toBeInTheDocument()
      expect(await screen.findByText('Recount 37 urgent cartons')).toBeInTheDocument()
      expect(screen.queryByText('Urgent signage for opening')).not.toBeInTheDocument()
    } finally {
      location.hash = ''
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('a view filtering on a deleted project says the project is unavailable and shows no other project’s tasks', async ({ admin }) => {
    await install()
    try {
      const gone = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Closed pop-up store' } })
      const other = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Store opening readiness' } })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Hang 11 shelf labels', project: other.row_id } })
      await admin.delete(`/api/table/tasker.project/${gone.row_id}?updated_at=${encodeURIComponent(String(gone.updated_at))}`)
      await admin.put('/api/user_settings/tasker.saved-views', { views: [{
        id: 'pop-up', name: 'Pop-up store work', scope: { kind: 'all' },
        setup: { search: '', filters: { states: [], responsiblePeople: [], urgencies: [], projects: [gone.row_id] } },
      }] })
      renderTasker(admin)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: /Views/ }))
      expect(await screen.findByText('One or more projects are unavailable')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Pop-up store work/ }))
      expect(await screen.findByRole('heading', { name: 'Pop-up store work' })).toBeInTheDocument()
      expect(screen.queryByText('Hang 11 shelf labels')).not.toBeInTheDocument()
    } finally {
      location.hash = ''
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Task details keep your place', () => {
  test('closing a project task’s details returns to the same project', async ({ admin }) => {
    await install()
    try {
      const project = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Warehouse review' } })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Count closing stock', project: project.row_id } })
      renderTasker(admin)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Warehouse review' }, { timeout: 5000 }))
      await user.click(await screen.findByRole('link', { name: 'Count closing stock' }))
      const details = await screen.findByRole('complementary', { name: 'Task details' })
      await user.click(within(details).getByRole('link', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Task details' })).not.toBeInTheDocument())
      expect(screen.getByRole('heading', { name: 'Warehouse review' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Count closing stock' })).toBeInTheDocument()
    } finally {
      location.hash = ''
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Every task row offers the same controls', () => {
  test('a Blocked task row shows its latest comment under its title, alongside a done tick', async ({ admin }) => {
    await install()
    try {
      const task = await admin.post<Record<string, unknown>>('/api/save_row', {
        table: 'tasker.task', row: { task_title: 'Restock aisle 7', task_state: 'Blocked', urgent: true },
      })
      for (const content of ['Asked the warehouse', 'Waiting for supplier'])
        await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: task.row_id, content } })
      renderTasker(admin)

      const row = (await screen.findByRole('combobox', { name: 'State for Restock aisle 7' })).closest('article') as HTMLElement
      expect(await within(row).findByText('Waiting for supplier')).toBeInTheDocument()
      expect(within(row).queryByText('Asked the warehouse')).not.toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: 'Mark Restock aisle 7 done' })).not.toBeChecked()
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('Choosing people when the team list is hidden', () => {
  test('a member who may not see the list of people is told so, and can still pick themselves and anyone already on a task', async ({ admin, createUser }) => {
    await install()
    try {
      const member = await createUser({ roles: [] })
      const colleague = await createUser({ roles: [] })
      await expect(member.get('/api/table/Person')).rejects.toMatchObject({ status: 403 })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Colleague’s count', assigned_to: colleague.user } })
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Unassigned count' } })
      renderTasker(member)

      expect(await screen.findByText(/people choices are limited/)).toBeInTheDocument()
      const picker = await screen.findByRole('combobox', { name: 'Assign Unassigned count' })
      const options = within(picker).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
      expect(options).toEqual(expect.arrayContaining([member.user, colleague.user]))
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('What the Inbox holds', () => {
  // SPEC: What the Inbox holds — suspected defect, see report. Tasker loads
  // only the 500 oldest tasks, so once a team has 500 tasks a newly captured
  // one never shows in the Inbox (or any list).
  test.fails('a task captured after the team already has 500 tasks still shows in the Inbox', async ({ admin }) => {
    await install()
    try {
      await sql`insert into tasker.task (row_id, task_title, task_state, is_done, urgent, project, created_at, updated_at)
        select 'TASK-OLD-' || n, 'Older task ' || n, 'Done', true, false, null, now() - interval '1 day' + n * interval '1 second', now()
        from generate_series(1, 500) as n`
      await admin.post('/api/save_row', { table: 'tasker.task', row: { task_title: 'Call the supplier about 17 pallets' } })
      renderTasker(admin)
      expect(await screen.findByText('Call the supplier about 17 pallets', {}, { timeout: 5000 })).toBeInTheDocument()
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})
