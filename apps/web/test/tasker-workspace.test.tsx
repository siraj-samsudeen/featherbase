import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { installApp } from 'server/src/apps'
import { taskerClient } from '../../server/test/tasker-client'
import { test, expect } from './pg-test'
import { setSession } from '../src/lib/api'
import { Recurrence } from '../../../example-apps/tasker/src/RecurrenceControls'
import { Discussion } from '../../../example-apps/tasker/src/Discussion'
import { TaskActions } from '../../../example-apps/tasker/src/TaskActions'
import { Subtasks } from '../../../example-apps/tasker/src/Subtasks'

const source = resolve('../..', 'example-apps/tasker')
const clientOptions = { defaultOptions: { queries: { retry: false } } }

for (const mode of ['monthly', 'after_completion'] as const) {
  test(`a task owner configures ${mode} repeats through its controls`, async ({ createUser }) => {
    expect(await discoverPackages([source])).toEqual([])
    await installApp('tasker')
    const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
    const task = await owner.post<{ row_id: string; updated_at: string; recurrence: string | null }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Repeat the stock review' } })
    setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
    const client = new QueryClient(clientOptions)
    const onSaved = async () => {
      const current = await owner.get<typeof task>(`/api/table/tasker.task/${task.row_id}`)
      view.rerender(<QueryClientProvider client={client}><Recurrence task={current} onSaved={onSaved} /></QueryClientProvider>)
    }
    const view = render(<QueryClientProvider client={client}><Recurrence task={task} onSaved={onSaved} /></QueryClientProvider>)
    const user = userEvent.setup()
    await user.click(screen.getByText('Make this task recurring'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Repeat by' }), mode)
    const interval = screen.getByRole('spinbutton', { name: 'Every' })
    await user.clear(interval)
    await user.type(interval, '2')
    if (mode === 'monthly') fireEvent.change(screen.getByLabelText('Starting date'), { target: { value: '2026-11-30' } })
    await user.click(screen.getByRole('button', { name: 'Save repeats' }))
    expect(await screen.findByText(mode === 'monthly' ? 'Repeats · every 2 months' : 'Repeats · every 2 days after completion')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause repeats' }))
    expect(await screen.findByText(/^Paused · every 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume repeats' }))
    expect(await screen.findByRole('button', { name: 'Pause repeats' })).toBeEnabled()
    const current = await owner.get<typeof task>(`/api/table/tasker.task/${task.row_id}`)
    expect(await owner.get(`/api/table/tasker.recurrence/${current.recurrence}`)).toMatchObject({ schedule_mode: mode, interval: 2, paused: false })
  })
}

test('question and reply composers retain their conversation relationship', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const asker = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Asha' }))
  const responder = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const project = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Receiving review' } })
  const task = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Check receiving', project: project.row_id } })
  setSession(asker.token!, { row_id: asker.user!, email: null, full_name: 'Asha' })
  const view = render(<QueryClientProvider client={new QueryClient(clientOptions)}><Discussion taskId={task.row_id} shared /></QueryClientProvider>)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Message type' }), 'Question')
  await screen.findByRole('option', { name: 'Ravi' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Reply needed from' }), responder.user!)
  await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Which bay should receive the load?')
  await user.click(screen.getByRole('button', { name: 'Post question' }))
  expect(await screen.findByText('Waiting for reply')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('')
  view.unmount()
  setSession(responder.token!, { row_id: responder.user!, email: null, full_name: 'Ravi' })
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><Discussion taskId={task.row_id} shared /></QueryClientProvider>)
  await user.type(await screen.findByRole('textbox', { name: 'Reply to Which bay should receive the load?' }), 'Use bay three.')
  await user.click(screen.getByRole('button', { name: /^Reply$/ }))
  expect(await screen.findByText('Use bay three.')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply to Which bay should receive the load?' })).toHaveValue(''))
  expect(screen.getByText('Needs asker’s review')).toBeInTheDocument()
})

test('subtask responsibility can be assigned to a teammate in shared work', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Asha' }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const project = await owner.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Shared review' } })
  const parent = await owner.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review deliveries', project: project.row_id } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: 'Asha' })
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><Subtasks taskId={parent.row_id} shared creator={owner.user!} parentState="Not started" onOpen={() => {}} /></QueryClientProvider>)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'New subtask' }), 'Count delivered boxes')
  await screen.findAllByRole('option', { name: 'Ravi' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Subtask responsibility' }), teammate.user!)
  await user.click(screen.getByRole('button', { name: 'Add subtask' }))
  const assigned = await screen.findByRole('combobox', { name: 'Assign subtask Count delivered boxes' })
  expect(assigned).toHaveValue(teammate.user)
  await waitFor(() => expect(assigned).toBeEnabled())
  await user.selectOptions(assigned, '')
  await waitFor(() => expect(assigned).toBeEnabled())
  const list = await owner.get<{ data: { row_id: string; updated_at: string }[] }>(`/api/table/tasker.task?filters=${encodeURIComponent(JSON.stringify([['parent_task', '=', parent.row_id]]))}`)
  const child = await owner.get<{ row_id: string; updated_at: string }>(`/api/table/tasker.task/${list.data[0].row_id}`)
  const current = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { row_id: child.row_id, updated_at: child.updated_at, description: 'A competing correction' } })
  await user.selectOptions(screen.getByRole('combobox', { name: 'State for subtask Count delivered boxes' }), 'Done')
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed|conflict|modified/i)
  expect(await owner.get(`/api/table/tasker.task/${current.row_id}`)).toMatchObject({ task_state: 'Not started', description: 'A competing correction' })
})

test('accidental deletion refuses a task with retained work', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Retain an urgent follow-up', urgent: true } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  let completed = false
  render(<TaskActions task={task} disabled={false} onCompleted={async () => { completed = true }} />)
  const user = userEvent.setup()
  await user.click(screen.getByText('More actions'))
  await user.click(screen.getByRole('button', { name: 'Delete accidental task' }))
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/retained|history|Cancelled/)
  expect(completed).toBe(false)
  expect(await owner.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ task_title: 'Retain an urgent follow-up', urgent: true })
})

test('a stale promotion reports the authoritative refusal without creating a project', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review the corrected task' } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  let completed = false
  render(<TaskActions task={task} disabled={false} onCompleted={async () => { completed = true }} />)
  await owner.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, description: 'A correction made after opening the action' } })
  const user = userEvent.setup()
  await user.click(screen.getByText('More actions'))
  await user.click(screen.getByRole('button', { name: 'Promote to project' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed|reopen/i)
  expect(completed).toBe(false)
  expect((await owner.get<{ total: number }>('/api/table/tasker.project')).total).toBe(0)
  expect(screen.queryByRole('button', { name: 'Retry same request' })).not.toBeInTheDocument()
})

test('a stale repeat setup retains its form after the server refuses the revision', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Repeat only the current revision' } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><Recurrence task={task} onSaved={async () => {}} /></QueryClientProvider>)
  await owner.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, description: 'Corrected before repeating' } })
  const user = userEvent.setup()
  await user.click(screen.getByText('Make this task recurring'))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Repeat by' }), 'after_completion')
  await user.click(screen.getByRole('button', { name: 'Save repeats' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed|reopen|revision/i)
  expect(screen.getByRole('combobox', { name: 'Repeat by' })).toHaveValue('after_completion')
  expect(await owner.get(`/api/table/tasker.task/${task.row_id}`)).toMatchObject({ recurrence: null, description: 'Corrected before repeating' })
})

test('a missing recurrence exposes a retry instead of a false repeat schedule', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Inspect missing repeat instructions' } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  const client = new QueryClient(clientOptions)
  const bridgedFetch = globalThis.fetch
  let reads = 0
  // Observe the HTTP seam while retaining its real server responses.
  globalThis.fetch = (input, init) => {
    if (String(input).includes('/api/table/tasker.recurrence/unavailable-series')) reads++
    return bridgedFetch(input, init)
  }
  try {
    render(<QueryClientProvider client={client}><Recurrence task={{ ...task, recurrence: 'unavailable-series' }} onSaved={async () => {}} /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load repeats:')
    expect(reads).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.queryByRole('button', { name: 'Pause repeats' })).not.toBeInTheDocument()
  } finally { globalThis.fetch = bridgedFetch }
})

test('a refused mark-read leaves the task update unread', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Keep unread evidence' } })
  await owner.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Update', body: 'Please inspect this update' } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><Discussion taskId={task.row_id} shared={false} /></QueryClientProvider>)
  const read = await screen.findByRole('button', { name: 'Mark read' })
  await owner.post('/api/logout', {})
  await userEvent.click(read)
  expect(await screen.findByRole('alert')).toHaveTextContent(/expired|session/i)
  expect(screen.getByText('Unread')).toBeInTheDocument()
  expect(screen.getByText('Please inspect this update')).toBeInTheDocument()
})

test('a task link can be retried once its creator deliberately shares the work', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const teammate = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const task = await owner.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Shared after the link arrived' } })
  setSession(teammate.token!, { row_id: teammate.user!, email: null, full_name: null })
  location.hash = `#task=${task.row_id}`
  const { TaskManagementPage } = await import('../../../example-apps/tasker/src/TaskManagement')
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><TaskManagementPage /></QueryClientProvider>)
  try {
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByRole('heading', { name: 'Shared after the link arrived' })).not.toBeInTheDocument()
    const project = await owner.post<{ row_id: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Deliberately shared' } })
    await owner.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, project: project.row_id } })
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: 'Shared after the link arrived' })).toBeInTheDocument()
  } finally { location.hash = '' }
})

test('subtasks do not expose an independent recurrence editor', () => {
  render(<QueryClientProvider client={new QueryClient(clientOptions)}><Recurrence task={{ row_id: 'child', updated_at: '', parent_task: 'parent' }} onSaved={async () => {}} /></QueryClientProvider>)
  expect(screen.queryByRole('region', { name: 'Recurring task' })).not.toBeInTheDocument()
  expect(screen.queryByText('Make this task recurring')).not.toBeInTheDocument()
})

test('Escape discards a project description draft without overwriting shared context', async ({ createUser }) => {
  expect(await discoverPackages([source])).toEqual([])
  await installApp('tasker')
  const owner = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await owner.post<{ row_id: string; updated_at: string; description: string }>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Retain project context', description: 'Keep the agreed scope' } })
  setSession(owner.token!, { row_id: owner.user!, email: null, full_name: null })
  const { ProjectDescription } = await import('../../../example-apps/tasker/src/ProjectDescription')
  render(<ProjectDescription project={project} onSaved={async () => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Edit description' }))
  await user.type(screen.getByRole('textbox', { name: /Project description/ }), 'Discard this addition')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('textbox', { name: /Project description/ })).not.toBeInTheDocument()
  expect(screen.getByText('Keep the agreed scope')).toBeInTheDocument()
  expect(await owner.get(`/api/table/tasker.project/${project.row_id}`)).toMatchObject({ description: 'Keep the agreed scope' })
})

test('conversation replies are displayed chronologically from unordered message input', async () => {
  const { repliesTo } = await import('../../../example-apps/tasker/src/discussions')
  const base = { task: 'task', kind: 'Reply' as const, body: 'Reply', parent_message: 'question', reply_needed_from: null, reply_cycle: 0, resolved: false, created_by: 'member', updated_at: '2026-11-03T10:00:00.000Z' }
  const root = { ...base, row_id: 'question', kind: 'Question' as const, parent_message: null, created_at: '2026-11-03T08:00:00.000Z' }
  const later = { ...base, row_id: 'later', created_at: '2026-11-03T10:00:00.000Z' }
  const earlier = { ...base, row_id: 'earlier', created_at: '2026-11-03T09:00:00.000Z' }
  const unrelated = { ...base, row_id: 'another-conversation', parent_message: 'different-question', created_at: '2026-11-03T08:30:00.000Z' }
  expect(repliesTo(root, [later, unrelated, root, earlier]).map(reply => reply.row_id)).toEqual(['earlier', 'later'])
})
