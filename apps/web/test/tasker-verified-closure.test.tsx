import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TestClient } from 'feather-testing-postgres'
import { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'
import { setSession } from '../src/lib/api'
import { test, expect } from './pg-test'
import { taskerClient } from '../../server/test/tasker-client'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
const SUBMITTED = 'Submitted for verification'

async function team(createUser: (options: { roles: string[]; fullName: string }) => Promise<TestClient>) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
  const meena = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Meena' }))
  const ravi = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const project = await meena.post<Row>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Diwali readiness' } })
  const task = await meena.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Fix the billing counter lights', project: project.row_id, assigned_to: ravi.user, verifier: meena.user, due_date: '2026-11-07' } })
  return { meena, ravi, project, task }
}

function renderTasker(as: TestClient) {
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
}

const read = (as: TestClient, task: Row) => as.get<Row>(`/api/table/tasker.task/${task.row_id}`)

async function openTask(user: ReturnType<typeof userEvent.setup>, project = 'Diwali readiness') {
  await user.click(await screen.findByRole('button', { name: project }))
  await user.click(await screen.findByRole('link', { name: 'Fix the billing counter lights' }))
  return screen.findByRole('region', { name: 'Task detail content' })
}

test('the assignee acknowledges the task and submits it with a note', async ({ createUser }) => {
  const { ravi, task } = await team(createUser)
  renderTasker(ravi)
  const user = userEvent.setup()
  const detail = await openTask(user)
  const row = () => screen.getByRole('link', { name: 'Fix the billing counter lights' }).closest('article')!
  await waitFor(() => expect(row()).toHaveTextContent('Not acknowledged by Ravi'))
  expect(within(detail).queryByRole('button', { name: 'Mark Done' })).not.toBeInTheDocument()
  await user.click(await within(detail).findByRole('button', { name: 'Acknowledge' }))
  await waitFor(() => expect(row()).not.toHaveTextContent('Not acknowledged'))
  const submitForVerification = within(detail).getByRole('button', { name: 'Submit for verification' })
  await waitFor(() => expect(submitForVerification).toBeEnabled())
  await user.click(submitForVerification)
  await user.click(within(detail).getByRole('button', { name: 'Submit' }))
  expect(await within(detail).findByRole('alert')).toHaveTextContent('Add a note on what was done')
  await user.type(within(detail).getByRole('textbox', { name: 'What was done' }), 'Replaced both tube lights')
  await user.click(within(detail).getByRole('button', { name: 'Submit' }))
  await waitFor(async () => expect(await read(ravi, task)).toMatchObject({ task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' }))
  await waitFor(() => expect(row()).toHaveTextContent('Waiting for Meena to verify'))
})

test('the verifier finds the task on To verify, returns it with a reason, then accepts it', async ({ createUser }) => {
  const { meena, ravi, task } = await team(createUser)
  const submitted = await ravi.post<Row>('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' } })
  const first = renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^To verify/ }))
  const page = await screen.findByRole('region', { name: 'To verify' })
  expect(await within(page).findByText('Replaced both tube lights')).toBeInTheDocument()
  await user.click(within(page).getByRole('link', { name: 'Fix the billing counter lights' }))
  const detail = await screen.findByRole('region', { name: 'Task detail content' })
  await user.click(await within(detail).findByRole('button', { name: 'Return' }))
  await user.type(within(detail).getByRole('textbox', { name: 'Reason for returning' }), 'Left counter still flickers')
  await user.click(within(detail).getByRole('button', { name: 'Return task' }))
  await waitFor(async () => expect(await read(meena, task)).toMatchObject({ task_state: 'In progress', return_reason: 'Left counter still flickers', return_count: 1 }))
  expect(await within(detail).findByText('Returned: Left counter still flickers')).toBeInTheDocument()
  const again = await read(ravi, task)
  await ravi.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: again.updated_at, task_state: SUBMITTED, evidence_note: 'Replaced the starter too' } })
  expect(submitted.row_id).toBe(task.row_id)
  first.unmount(); location.hash = ''
  renderTasker(meena)
  await user.click(await screen.findByRole('button', { name: /^To verify/ }))
  await user.click(await within(await screen.findByRole('region', { name: 'To verify' })).findByRole('link', { name: 'Fix the billing counter lights' }))
  const reopened = await screen.findByRole('region', { name: 'Task detail content' })
  await user.click(await within(reopened).findByRole('button', { name: 'Accept and close' }))
  await waitFor(async () => expect(await read(meena, task)).toMatchObject({ task_state: 'Done', verified_by: meena.user }))
  expect(await within(reopened).findByText(/^Verified by Meena/)).toBeInTheDocument()
})

test('moving a due date asks for a reason and the task shows the first date', async ({ createUser }) => {
  const { ravi, task } = await team(createUser)
  renderTasker(ravi)
  const user = userEvent.setup()
  const detail = await openTask(user)
  await waitFor(() => expect(within(detail).getByLabelText('Due date')).toBeEnabled())
  fireEvent.change(within(detail).getByLabelText('Due date'), { target: { value: '2026-11-10' } })
  await user.type(await within(detail).findByRole('textbox', { name: 'Reason for moving the due date' }), 'Electrician on leave')
  await user.click(within(detail).getByRole('button', { name: 'Move due date' }))
  await waitFor(async () => expect(await read(ravi, task)).toMatchObject({ extension_count: 1, extension_reason: 'Electrician on leave' }))
  expect(await within(detail).findByText('was 07-Nov-2026 · extended 1 time')).toBeInTheDocument()
})

test('cancelling from the task row asks for a reason first', async ({ createUser }) => {
  const { meena, task } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Diwali readiness' }))
  await user.selectOptions(await screen.findByRole('combobox', { name: 'State for Fix the billing counter lights' }), 'Cancelled')
  expect((await read(meena, task)).task_state).toBe('Not started')
  await user.type(await screen.findByRole('textbox', { name: 'Reason for cancelling' }), 'Lights replaced under warranty')
  await user.click(screen.getByRole('button', { name: 'Cancel task' }))
  await waitFor(async () => expect(await read(meena, task)).toMatchObject({ task_state: 'Cancelled', cancel_reason: 'Lights replaced under warranty' }))
  await waitFor(() => expect(screen.getByRole('link', { name: 'Fix the billing counter lights' }).closest('article')!).toHaveTextContent('Cancelled: Lights replaced under warranty'))
})

test('a project names its default verifier and task details change a task’s verifier', async ({ createUser }) => {
  const { meena, ravi, project, task } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Diwali readiness' }))
  // People's names arrive after the task list; until then the options read "Former member".
  const defaultVerifier = await screen.findByRole('combobox', { name: 'Default verifier' })
  await within(defaultVerifier).findByRole('option', { name: 'Meena' })
  await user.selectOptions(defaultVerifier, 'Meena')
  await waitFor(async () => expect((await meena.get<Row>(`/api/table/tasker.project/${project.row_id}`)).default_verifier).toBe(meena.user))
  await user.click(await screen.findByRole('link', { name: 'Fix the billing counter lights' }))
  const detail = await screen.findByRole('region', { name: 'Task detail content' })
  const verifier = await within(detail).findByRole('combobox', { name: 'Task verifier' })
  expect(within(verifier).queryByRole('option', { name: 'Ravi' })).not.toBeInTheDocument()
  await user.selectOptions(verifier, 'No verifier')
  await waitFor(async () => expect((await read(meena, task)).verifier).toBeNull())
  expect(ravi.user).toBeTruthy()
})

const acknowledge = (ravi: TestClient, task: Row) =>
  ravi.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, acknowledged_at: new Date().toISOString() } })

async function startSubmitting(detail: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  const submitForVerification = await within(detail).findByRole('button', { name: 'Submit for verification' })
  await waitFor(() => expect(submitForVerification).toBeEnabled())
  await user.click(submitForVerification)
}

test('Not yet closes the submit form and leaves the task unsubmitted', async ({ createUser }) => {
  const { ravi, task } = await team(createUser)
  await acknowledge(ravi, task)
  renderTasker(ravi)
  const user = userEvent.setup()
  const detail = await openTask(user)
  await startSubmitting(detail, user)
  await user.click(within(detail).getByRole('button', { name: 'Not yet' }))
  expect(within(detail).queryByRole('textbox', { name: 'What was done' })).not.toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: 'Submit for verification' })).toBeInTheDocument()
  expect((await read(ravi, task)).task_state).not.toBe(SUBMITTED)
})

test('the verifier changes their mind about returning, and the task stays submitted', async ({ createUser }) => {
  const { meena, ravi, task } = await team(createUser)
  await ravi.post('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: task.updated_at, task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' } })
  renderTasker(meena)
  const user = userEvent.setup()
  const detail = await openTask(user)
  await user.click(await within(detail).findByRole('button', { name: 'Return' }))
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'Reason for returning' })).not.toBeInTheDocument()
  expect(within(detail).getByRole('button', { name: 'Accept and close' })).toBeInTheDocument()
  expect((await read(meena, task)).task_state).toBe(SUBMITTED)
})

test('Never mind in task details keeps the task when cancelling is abandoned', async ({ createUser }) => {
  const { meena, task } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  const detail = await openTask(user)
  const state = await within(detail).findByRole('combobox', { name: 'Task state' })
  await waitFor(() => expect(state).toBeEnabled())
  await user.selectOptions(state, 'Cancelled')
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'Reason for cancelling' })).not.toBeInTheDocument()
  expect((await read(meena, task)).task_state).toBe('Not started')
})

test('Never mind in task details keeps the due date when moving it is abandoned', async ({ createUser }) => {
  const { ravi, task } = await team(createUser)
  renderTasker(ravi)
  const user = userEvent.setup()
  const detail = await openTask(user)
  await waitFor(() => expect(within(detail).getByLabelText('Due date')).toBeEnabled())
  fireEvent.change(within(detail).getByLabelText('Due date'), { target: { value: '2026-11-10' } })
  await within(detail).findByRole('textbox', { name: 'Reason for moving the due date' })
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'Reason for moving the due date' })).not.toBeInTheDocument()
  expect(String((await read(ravi, task)).due_date).slice(0, 10)).toBe('2026-11-07')
})

test('Never mind on the task row keeps the task when cancelling is abandoned', async ({ createUser }) => {
  const { meena, task } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Diwali readiness' }))
  await user.selectOptions(await screen.findByRole('combobox', { name: 'State for Fix the billing counter lights' }), 'Cancelled')
  await user.click(await screen.findByRole('button', { name: 'Never mind' }))
  expect(screen.queryByRole('textbox', { name: 'Reason for cancelling' })).not.toBeInTheDocument()
  expect((await read(meena, task)).task_state).toBe('Not started')
})

test('the default verifier says why it was not saved when someone changed the project first', async ({ createUser }) => {
  const { meena, project } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Diwali readiness' }))
  const defaultVerifier = await screen.findByRole('combobox', { name: 'Default verifier' })
  await within(defaultVerifier).findByRole('option', { name: 'Meena' })
  await meena.post('/api/save_row', { table: 'tasker.project', row: { row_id: project.row_id, updated_at: project.updated_at, description: 'Lights and counters before Diwali' } })
  await user.selectOptions(defaultVerifier, 'Meena')
  expect(await screen.findByRole('alert')).toHaveTextContent(`tasker.project ${project.row_id} has been modified after you loaded it`)
  expect((await meena.get<Row>(`/api/table/tasker.project/${project.row_id}`)).default_verifier).toBeNull()
})
