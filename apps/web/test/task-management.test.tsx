import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TestClient } from 'feather-testing-postgres'
import { peopleWithTaskResponsibility, TaskManagementPage } from '../../../runtime-apps/tasker/src/TaskManagement'
import { Markdown } from '../../../runtime-apps/tasker/src/Markdown'
import { setSession } from '../src/lib/api'
import { test, expect } from './pg-test'

const APP = 'tasker'

function renderTasker(as: TestClient) {
  if (!as.token || !as.user) throw new Error('Tasker fixture requires a signed-in user')
  setSession(as.token, { row_id: as.user, email: as.user, full_name: null })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
}

async function install() {
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  if (await isInstalled(APP)) await uninstallApp(APP)
  await installApp(APP)
}

// @spec together_groups_active_responsibility
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

// @spec lightweight_project_entry.add_initial_project_tasks
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

// @spec projects_landing_connects_directory_and_creation
// @spec responsive_detail_preserves_workspace_context
// @spec workspace_navigation_is_stable
test('projects_landing_flow: the directory opens a project and keeps its context behind task details', async ({ admin }) => {
  await install()
  try {
    renderTasker(admin)
    const user = userEvent.setup()

    const navigation = await screen.findByRole('navigation', { name: 'Task views' })
    expect(Array.from(navigation.querySelectorAll(':scope > button')).map((button) => button.textContent?.replace(/\d+$/, ''))).toEqual([
      'Inbox', 'My Work', 'Together', 'Personal tasks', 'Projects',
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

// @spec focus_is_private_ordered.mixed_daily_shortlist
// @spec my_work_has_no_duplicates.focused_assigned_once
// @spec focus_never_mutates_task.star_unassigned_task
// @spec stale_focus_self_heals.missing_focus_reference
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

// @spec discussion_stays_append_only.optional_inactive_explanation
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

// @spec assignment_state_independent
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

// @spec project_name_is_correctable.rename_keeps_tasks
// @spec project_tabs_are_private_ordered.frequent_project_switching
// @spec together_groups_active_responsibility.assigned_unassigned_and_finished
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
    expect(await admin.get('/api/user_settings/tasker.projects')).toEqual({
      settings: { project_ids: [second.row_id, first.row_id] },
    })
    expect(await member.get('/api/user_settings/tasker.projects')).toEqual({ settings: null })

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

// @spec markdown_cannot_execute_html.malicious_markup_is_inert
test('markdown_safety: links lists and code render but HTML and unsafe URLs remain inert', () => {
  const { container } = render(<Markdown>{'- First\n- Second\n\n[Safe](https://example.test) [Unsafe](javascript:alert(1))\n\n`inline`\n\n```js\nconst n = 3\n```\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.test"></iframe>'}</Markdown>)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('link', { name: 'Safe' })).toHaveAttribute('href', 'https://example.test')
  expect(container.querySelector('pre code')).toHaveTextContent('const n = 3')
  expect(container.querySelector('script, iframe, img, [onerror]')).toBeNull()
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
})

// @spec project_markdown_is_shared.shared_context_and_empty_content
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

// @spec project_markdown_is_shared.stale_project_draft
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

// @spec assignment_state_independent.assign_not_started_task
// @spec my_work_has_no_duplicates
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

// @spec task_activity_stays_in_tasker.correct_title_and_description
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

// @spec task_activity_stays_in_tasker.cancel_or_conflict_preserves_work
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

// @spec task_detail_has_three_modes.choose_depth_without_losing_task
// @spec task_activity_stays_in_tasker.comment_and_edit_are_visible
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

// @spec task_lists_present_one_consistent_control_set
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
