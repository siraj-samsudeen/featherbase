import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { saveDoc } from 'server/src/document'
import { enqueue, drainJobs } from 'server/src/jobs'
import { sql } from 'server/src/db'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TestClient } from 'feather-testing-postgres'
import { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'
import { setSession } from '../src/lib/api'
import { test, expect } from './pg-test'
import { taskerClient } from '../../server/test/tasker-client'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
const ISSUE = 'tasker.issue'

async function team(createUser: (options: { roles: string[]; fullName: string }) => Promise<TestClient>) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
  const meena = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Meena' }))
  const suresh = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Suresh' }))
  const kumar = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Kumar' }))
  const store = await meena.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'ATK Avadi', store_manager: meena.user } })
  await meena.post('/api/save_row', { table: 'tasker.function_head', row: { owner_function: 'Facilities', head: kumar.user } })
  return { meena, suresh, kumar, store }
}

function renderTasker(as: TestClient) {
  setSession(as.token!, { row_id: as.user!, email: as.user!, full_name: null })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
}

const issueFields = { issue_title: 'Dairy chiller 2 at 9°C', category: 'Equipment failure', severity: 'High', owner_function: 'Facilities' }
const read = (as: TestClient, id: string) => as.get<Row>(`/api/table/${ISSUE}/${id}`)

/** An issue raised two days ago, then checked by the escalation job now. */
async function breachedIssue(meena: TestClient, values: Record<string, unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] })
  let issue: Row
  try {
    vi.setSystemTime(Date.now() - 2 * 86_400_000)
    issue = await saveDoc(ISSUE, { ...issueFields, severity: 'Critical', ...values }, meena.user!) as Row
  } finally { vi.useRealTimers() }
  await enqueue('tasker.escalate_issues', {})
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
  await drainJobs()
  return issue
}

test('a member raises an issue and sees it on the Issues page with its deadlines', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await screen.findByRole('button', { name: 'Raise an issue' }))
  const form = await screen.findByRole('form', { name: 'Raise an issue' })
  await user.type(within(form).getByRole('textbox', { name: 'What happened' }), 'Dairy chiller 2 at 9°C')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Category' }), 'Equipment failure')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Severity' }), 'High')
  await within(form).findByRole('option', { name: 'ATK Avadi' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Store' }), 'ATK Avadi')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Owner function' }), 'Facilities')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Owner' }), 'Suresh')
  await user.type(within(form).getByRole('textbox', { name: 'Impact' }), '40 crates of milk at risk')
  await user.type(within(form).getByRole('textbox', { name: 'Done right away' }), 'Stock moved to chiller 1')
  await user.click(within(form).getByRole('button', { name: 'Raise issue' }))
  const list = await screen.findByRole('list', { name: 'Open issues' })
  const row = await within(list).findByRole('listitem', { name: 'Dairy chiller 2 at 9°C' })
  expect(row).toHaveTextContent('High')
  expect(row).toHaveTextContent('ATK Avadi')
  expect(row).toHaveTextContent('Not acknowledged by Suresh')
  expect(row).toHaveTextContent(/Fix in/)
  const saved = await meena.get<{ data: Row[] }>(`/api/table/${ISSUE}?fields=["impact","containment","owner"]`)
  expect(saved.data).toEqual([{ impact: '40 crates of milk at risk', containment: 'Stock moved to chiller 1', owner: suresh.user }])
})

test('the owner acknowledges an issue and its log shows each step', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, store: store.row_id, owner: suresh.user } })
  renderTasker(suresh)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  const detail = await screen.findByRole('region', { name: 'Issue detail' })
  expect(within(detail).getByRole('group', { name: 'Response clock' })).toHaveTextContent(/Respond by/)
  await user.click(within(detail).getByRole('button', { name: 'Acknowledge' }))
  await waitFor(async () => expect((await read(suresh, issue.row_id)).issue_state).toBe('Acknowledged'))
  const log = within(detail).getByRole('list', { name: 'Escalation log' })
  await waitFor(() => expect(log).toHaveTextContent('Acknowledged by Suresh'))
  expect(log).toHaveTextContent('Assigned · notice to Suresh')
})

test('a breached issue shows in red, counts as breached, and its log names who was told', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  await breachedIssue(meena, { store: store.row_id, owner: suresh.user })
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  const counts = await screen.findByRole('group', { name: 'Issue counts' })
  await waitFor(() => expect(within(counts).getByText('Breached').closest('div')).toHaveTextContent('1'))
  const row = within(screen.getByRole('list', { name: 'Open issues' })).getByRole('listitem', { name: 'Dairy chiller 2 at 9°C' })
  expect(within(row).getByText(/^Breached by/)).toHaveAttribute('data-tone', 'breached')
  await user.click(within(row).getByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  const log = within(await screen.findByRole('region', { name: 'Issue detail' })).getByRole('list', { name: 'Escalation log' })
  await waitFor(() => expect(log).toHaveTextContent('75% reminder · notice to Suresh'))
  expect(log).toHaveTextContent('Breached · notice to Meena, Kumar')
  expect(await screen.findByRole('region', { name: 'For you' })).toHaveTextContent('Breached')
})

test('waiting for a vendor needs the store manager’s approval, then closure goes through the verifier', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, store: store.row_id, owner: suresh.user, verifier: meena.user } })
  const owner = renderTasker(suresh)
  let user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  let detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.click(within(detail).getByRole('button', { name: 'Waiting for vendor' }))
  await user.type(within(detail).getByRole('textbox', { name: 'What you are waiting for' }), 'Blue Star visit booked')
  await user.type(within(detail).getByLabelText('Next review'), '2026-11-10')
  await user.click(within(detail).getByRole('button', { name: 'Ask to pause' }))
  await waitFor(async () => expect(await read(suresh, issue.row_id)).toMatchObject({ pause_requested: true, paused: false }))
  expect(await within(detail).findByText(/Pause asked for · the clock runs until the store manager approves/)).toBeInTheDocument()
  owner.unmount(); location.hash = ''

  const manager = renderTasker(meena)
  user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.click(await within(detail).findByRole('button', { name: 'Approve pause' }))
  await waitFor(async () => expect((await read(meena, issue.row_id)).paused).toBe(true))
  expect(await within(detail).findByText(/^Paused since/)).toBeInTheDocument()
  const resume = within(detail).getByRole('button', { name: 'Resume clock' })
  await waitFor(() => expect(resume).toBeEnabled())
  await user.click(resume)
  await waitFor(async () => expect((await read(meena, issue.row_id)).paused).toBe(false))
  const resumed = await read(meena, issue.row_id)
  await suresh.post('/api/save_row', { table: ISSUE, row: { row_id: issue.row_id, updated_at: resumed.updated_at, issue_state: 'Acknowledged' } })
  const acknowledged = await read(meena, issue.row_id)
  await suresh.post('/api/save_row', { table: ISSUE, row: { row_id: issue.row_id, updated_at: acknowledged.updated_at, issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced' } })
  // Meena opens Tasker again to see the submission.
  manager.unmount(); location.hash = ''
  renderTasker(meena)
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.click(await within(detail).findByRole('button', { name: 'Accept and close' }))
  await waitFor(async () => expect(await read(meena, issue.row_id)).toMatchObject({ issue_state: 'Closed', verified_by: meena.user }))
})

test('corrective tasks are added from the issue and the SLA rules page sets times and people', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, store: store.row_id, owner: suresh.user } })
  renderTasker(meena)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  const detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.type(within(detail).getByRole('textbox', { name: 'New corrective task' }), 'Call Blue Star for a compressor check{Enter}')
  expect(await within(within(detail).getByRole('list', { name: 'Corrective tasks' })).findByText('Call Blue Star for a compressor check')).toBeInTheDocument()
  const tasks = await meena.get<{ data: Row[] }>(`/api/table/tasker.task?fields=["issue","shared","store"]`)
  expect(tasks.data).toEqual([{ issue: issue.row_id, shared: true, store: store.row_id }])

  await user.click(screen.getByRole('button', { name: 'SLA rules and people' }))
  const rules = await screen.findByRole('table', { name: 'SLA rules' })
  const high = within(rules).getByRole('row', { name: /High/ })
  await user.clear(within(high).getByRole('spinbutton', { name: 'High: fix within hours' }))
  await user.type(within(high).getByRole('spinbutton', { name: 'High: fix within hours' }), '12')
  await user.click(within(high).getByRole('button', { name: 'Save High' }))
  await waitFor(async () => expect((await meena.get<{ data: Row[] }>('/api/table/tasker.sla_rule?fields=["severity","fix_minutes","clock"]')).data)
    .toEqual([{ severity: 'High', fix_minutes: 720, clock: 'Store hours' }]))
  const people = screen.getByRole('table', { name: 'Store managers and hours' })
  await user.clear(within(people).getByRole('textbox', { name: 'ATK Avadi closes at' }))
  await user.type(within(people).getByRole('textbox', { name: 'ATK Avadi closes at' }), '23:00{Enter}')
  await waitFor(async () => expect((await meena.get<Row>(`/api/table/tasker.store/${store.row_id}`)).closes_at).toBe('23:00'))
  expect(within(screen.getByRole('table', { name: 'Function heads' })).getByRole('combobox', { name: 'Facilities head' })).toHaveValue(kumar.user)
})
