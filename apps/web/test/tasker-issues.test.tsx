import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { getDoc, saveDoc } from 'server/src/document'
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

async function openIssues(as: TestClient) {
  renderTasker(as)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Issues/ }))
  return user
}

async function openIssue(as: TestClient, title = 'Dairy chiller 2 at 9°C') {
  const user = await openIssues(as)
  await user.click(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: title }))
  return { user, detail: await screen.findByRole('region', { name: 'Issue detail' }) }
}

test('the raise form records when the issue happened and the asset involved', async ({ createUser }) => {
  const { meena } = await team(createUser)
  const user = await openIssues(meena)
  await user.click(await screen.findByRole('button', { name: 'Raise an issue' }))
  const form = await screen.findByRole('form', { name: 'Raise an issue' })
  await user.type(within(form).getByRole('textbox', { name: 'What happened' }), 'Dairy chiller 2 at 9°C')
  fireEvent.change(within(form).getByLabelText('Happened at'), { target: { value: '2026-11-07T08:30' } })
  await user.type(within(form).getByRole('textbox', { name: 'Asset or area' }), 'Dairy chiller 2')
  await user.click(within(form).getByRole('button', { name: 'Raise issue' }))
  await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('listitem', { name: 'Dairy chiller 2 at 9°C' })
  const saved = await meena.get<{ data: Row[] }>(`/api/table/${ISSUE}?fields=["occurred_at","asset_area"]`)
  expect(saved.data).toEqual([{ occurred_at: new Date('2026-11-07T08:30').toISOString(), asset_area: 'Dairy chiller 2' }])
})

/** Someone is taken out of Tasker while a colleague's page still lists them. */
async function leaveTasker(person: TestClient) {
  const doc = await getDoc('Person', person.user!, 'Administrator')
  await saveDoc('Person', { ...doc, roles: (doc.roles as { role: string }[]).filter(entry => entry.role !== 'Tasker Member') }, 'Administrator')
}

test('raising an issue for an owner who has left Tasker says why it was refused', async ({ createUser }) => {
  const { meena, kumar } = await team(createUser)
  const user = await openIssues(meena)
  await user.click(await screen.findByRole('button', { name: 'Raise an issue' }))
  const form = await screen.findByRole('form', { name: 'Raise an issue' })
  await user.type(within(form).getByRole('textbox', { name: 'What happened' }), 'Dairy chiller 2 at 9°C')
  await within(within(form).getByRole('combobox', { name: 'Owner' })).findByRole('option', { name: 'Kumar' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Owner' }), 'Kumar')
  await leaveTasker(kumar)
  await user.click(within(form).getByRole('button', { name: 'Raise issue' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Choose a Tasker member')
  expect((await meena.get<{ data: Row[] }>(`/api/table/${ISSUE}`)).data).toEqual([])
})

test('changing the owner of an issue someone else just changed says why it was refused', async ({ createUser }) => {
  const { meena, suresh, kumar } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user } })
  const { user, detail } = await openIssue(meena)
  const owner = within(detail).getByRole('combobox', { name: 'Issue owner' })
  await within(owner).findByRole('option', { name: 'Kumar' })
  await meena.post('/api/save_row', { table: ISSUE, row: { row_id: issue.row_id, updated_at: issue.updated_at, impact: '40 crates of milk at risk' } })
  await user.selectOptions(owner, 'Kumar')
  expect(await within(detail).findByRole('alert')).toHaveTextContent(`${ISSUE} ${issue.row_id} has been modified after you loaded it`)
  expect((await read(meena, issue.row_id)).owner).toBe(suresh.user)
  expect(kumar.user).not.toBe(suresh.user)
})

test('the owner submits an issue for verification with a note on what was done', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user, verifier: meena.user } })
  const { user, detail } = await openIssue(suresh)
  await user.click(within(detail).getByRole('button', { name: 'Submit for verification' }))
  await user.type(within(detail).getByRole('textbox', { name: 'What was done' }), 'Compressor relay replaced')
  await user.click(within(detail).getByRole('button', { name: 'Submit' }))
  await waitFor(async () => expect(await read(suresh, issue.row_id)).toMatchObject({ issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced' }))
})

test('Not yet closes the issue’s submit form and leaves it open', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user, verifier: meena.user } })
  const { user, detail } = await openIssue(suresh)
  await user.click(within(detail).getByRole('button', { name: 'Submit for verification' }))
  await user.click(within(detail).getByRole('button', { name: 'Not yet' }))
  expect(within(detail).queryByRole('textbox', { name: 'What was done' })).not.toBeInTheDocument()
  expect((await read(suresh, issue.row_id)).issue_state).toBe('Open')
})

test('Never mind closes the pause form without asking for a pause', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user } })
  const { user, detail } = await openIssue(suresh)
  await user.click(within(detail).getByRole('button', { name: 'Waiting for vendor' }))
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'What you are waiting for' })).not.toBeInTheDocument()
  expect((await read(suresh, issue.row_id)).pause_requested).toBe(false)
})

async function submittedIssue(meena: TestClient, suresh: TestClient) {
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user, verifier: meena.user } })
  return suresh.post<Row>('/api/save_row', { table: ISSUE, row: { row_id: issue.row_id, updated_at: issue.updated_at, issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced' } })
}

test('the verifier returns a submitted issue with a reason', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const issue = await submittedIssue(meena, suresh)
  const { user, detail } = await openIssue(meena)
  await user.click(await within(detail).findByRole('button', { name: 'Return' }))
  await user.type(within(detail).getByRole('textbox', { name: 'Reason for returning' }), 'Still reads 7°C')
  await user.click(within(detail).getByRole('button', { name: 'Return issue' }))
  await waitFor(async () => expect(await read(meena, issue.row_id)).toMatchObject({ issue_state: 'Acknowledged', return_reason: 'Still reads 7°C', return_count: 1 }))
})

test('a closed issue is found under Show closed and reopened with a reason', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const submitted = await submittedIssue(meena, suresh)
  await meena.post('/api/save_row', { table: ISSUE, row: { row_id: submitted.row_id, updated_at: submitted.updated_at, issue_state: 'Closed' } })
  const user = await openIssues(meena)
  expect(await screen.findByText('No open issues.')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Show closed' }))
  await user.click(await within(await screen.findByRole('list', { name: 'All issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  const detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.click(within(detail).getByRole('button', { name: 'Reopen' }))
  await user.type(within(detail).getByRole('textbox', { name: 'Reason for reopening' }), 'Chiller warm again')
  await user.click(within(detail).getByRole('button', { name: 'Reopen issue' }))
  await waitFor(async () => expect(await read(meena, submitted.row_id)).toMatchObject({ issue_state: 'Acknowledged', closed_at: null }))
})

test('a person taken out of Tasker is told why their corrective task was not added', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  await meena.post<Row>('/api/save_row', { table: ISSUE, row: issueFields })
  const { user, detail } = await openIssue(meena)
  await leaveTasker(meena)
  await user.type(within(detail).getByRole('textbox', { name: 'New corrective task' }), 'Call Blue Star for a compressor check{Enter}')
  expect(await within(detail).findByRole('alert')).toHaveTextContent('permission')
  expect((await suresh.get<{ data: Row[] }>('/api/table/tasker.task')).data).toEqual([])
})

test('the For you notices list the newest first', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(Date.now() - 2 * 3_600_000)
    await saveDoc(ISSUE, { ...issueFields, issue_title: 'Till 3 short by ₹4,000', category: 'Cash shortage', owner: suresh.user }, meena.user!)
  } finally { vi.useRealTimers() }
  await meena.post('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user } })
  await openIssues(suresh)
  const notices = await screen.findByRole('region', { name: 'For you' })
  await waitFor(() => expect(within(notices).getAllByRole('link').map(link => link.textContent)).toEqual(['Dairy chiller 2 at 9°C', 'Till 3 short by ₹4,000']))
})

test('Issue list returns from the SLA rules page to the open issues', async ({ createUser }) => {
  const { meena } = await team(createUser)
  await meena.post('/api/save_row', { table: ISSUE, row: issueFields })
  const user = await openIssues(meena)
  await user.click(await screen.findByRole('button', { name: 'SLA rules and people' }))
  await screen.findByRole('table', { name: 'SLA rules' })
  await user.click(screen.getByRole('button', { name: 'Issue list' }))
  expect(await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' })).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: 'SLA rules' })).not.toBeInTheDocument()
})

async function openRules(as: TestClient) {
  const user = await openIssues(as)
  await user.click(await screen.findByRole('button', { name: 'SLA rules and people' }))
  return user
}

test('a severity’s respond time, clock and director wait are saved from the SLA rules page', async ({ createUser }) => {
  const { meena } = await team(createUser)
  const user = await openRules(meena)
  const low = within(await screen.findByRole('table', { name: 'SLA rules' })).getByRole('row', { name: /Low/ })
  await user.clear(within(low).getByRole('spinbutton', { name: 'Low: respond within hours' }))
  await user.type(within(low).getByRole('spinbutton', { name: 'Low: respond within hours' }), '8')
  await user.selectOptions(within(low).getByRole('combobox', { name: 'Low: clock' }), 'Round the clock')
  await user.type(within(low).getByRole('spinbutton', { name: 'Low: director after hours' }), '2')
  await user.click(within(low).getByRole('button', { name: 'Save Low' }))
  await waitFor(async () => expect((await meena.get<{ data: Row[] }>('/api/table/tasker.sla_rule?fields=["severity","respond_minutes","clock","director_after_minutes"]')).data)
    .toEqual([{ severity: 'Low', respond_minutes: 480, clock: 'Round the clock', director_after_minutes: 120 }]))
})

test('a category rule is added with its own times and clock', async ({ createUser }) => {
  const { meena } = await team(createUser)
  const user = await openRules(meena)
  const form = await screen.findByRole('form', { name: 'Add a category rule' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Category' }), 'Cash shortage')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Severity' }), 'Critical')
  await user.clear(within(form).getByRole('spinbutton', { name: 'Respond (hours)' }))
  await user.type(within(form).getByRole('spinbutton', { name: 'Respond (hours)' }), '0.5')
  await user.clear(within(form).getByRole('spinbutton', { name: 'Fix (hours)' }))
  await user.type(within(form).getByRole('spinbutton', { name: 'Fix (hours)' }), '3')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Clock' }), 'Store hours')
  await user.click(within(form).getByRole('button', { name: 'Add category rule' }))
  expect(await screen.findByText('Cash shortage · Critical: respond in 30m, fix in 3h, store hours')).toBeInTheDocument()
})

test('a store’s opening time is saved from the SLA rules page', async ({ createUser }) => {
  const { meena, store } = await team(createUser)
  const user = await openRules(meena)
  const people = await screen.findByRole('table', { name: 'Store managers and hours' })
  const opens = await within(people).findByRole('textbox', { name: 'ATK Avadi opens at' })
  await user.clear(opens)
  await user.type(opens, '08:00{Enter}')
  await waitFor(async () => expect((await meena.get<Row>(`/api/table/tasker.store/${store.row_id}`)).opens_at).toBe('08:00'))
})

test('naming a function head someone else named meanwhile says why it was refused', async ({ createUser }) => {
  const { meena, suresh, kumar } = await team(createUser)
  const user = await openRules(meena)
  const head = await within(await screen.findByRole('table', { name: 'Function heads' })).findByRole('combobox', { name: 'IT head' })
  await within(head).findByRole('option', { name: 'Suresh' })
  await kumar.post('/api/save_row', { table: 'tasker.function_head', row: { owner_function: 'IT', head: kumar.user } })
  await user.selectOptions(head, 'Suresh')
  expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate value for owner_function')
  const heads = await meena.get<{ data: Row[] }>('/api/table/tasker.function_head?fields=["owner_function","head"]&filters=[["owner_function","=","IT"]]')
  expect(heads.data).toEqual([{ owner_function: 'IT', head: kumar.user }])
  expect(suresh.user).toBeTruthy()
})

/** A Critical issue (4 hours round the clock) raised some minutes ago, then checked by the escalation job. */
async function issueRaisedAgo(meena: TestClient, minutes: number, values: Record<string, unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(Date.now() - minutes * 60_000)
    await saveDoc(ISSUE, { ...issueFields, severity: 'Critical', ...values }, meena.user!)
  } finally { vi.useRealTimers() }
  await enqueue('tasker.escalate_issues', {})
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
  await drainJobs()
}

test('an issue past 75% of its fix time shows how much is used', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  await issueRaisedAgo(meena, 190, { store: store.row_id, owner: suresh.user })
  const user = await openIssues(meena)
  const row = await within(await screen.findByRole('list', { name: 'Open issues' })).findByRole('listitem', { name: 'Dairy chiller 2 at 9°C' })
  expect(within(row).getByText(/% used$/)).toHaveAttribute('data-tone', 'warning')
  expect(within(row).getByText(/% used$/)).toHaveTextContent('Fix in 50m · 79% used')
  expect(within(screen.getByRole('group', { name: 'Issue counts' })).getByText('Past 75%').closest('div')).toHaveTextContent('1')
  expect(user).toBeTruthy()
})

test('the escalation log says when there is no one to escalate to', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  await breachedIssue(meena, { store: store.row_id, owner: suresh.user, owner_function: 'IT' })
  const { detail } = await openIssue(meena)
  await waitFor(() => expect(within(detail).getByRole('list', { name: 'Escalation log' })).toHaveTextContent('Escalation has no IT head'))
})

test('the issue’s verifier is changed from its details', async ({ createUser }) => {
  const { meena, suresh, kumar } = await team(createUser)
  const issue = await meena.post<Row>('/api/save_row', { table: ISSUE, row: { ...issueFields, owner: suresh.user } })
  const { user, detail } = await openIssue(meena)
  const verifier = within(detail).getByRole('combobox', { name: 'Issue verifier' })
  await within(verifier).findByRole('option', { name: 'Kumar' })
  await user.selectOptions(verifier, 'Kumar')
  await waitFor(async () => expect((await read(meena, issue.row_id)).verifier).toBe(kumar.user))
})

test('Never mind on returning keeps the issue waiting for the verifier', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const issue = await submittedIssue(meena, suresh)
  const { user, detail } = await openIssue(meena)
  await user.click(await within(detail).findByRole('button', { name: 'Return' }))
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'Reason for returning' })).not.toBeInTheDocument()
  expect((await read(meena, issue.row_id)).issue_state).toBe('Submitted for verification')
})

test('Never mind on reopening keeps the issue closed', async ({ createUser }) => {
  const { meena, suresh } = await team(createUser)
  const submitted = await submittedIssue(meena, suresh)
  await meena.post('/api/save_row', { table: ISSUE, row: { row_id: submitted.row_id, updated_at: submitted.updated_at, issue_state: 'Closed' } })
  const user = await openIssues(meena)
  await user.click(await screen.findByRole('checkbox', { name: 'Show closed' }))
  await user.click(await within(await screen.findByRole('list', { name: 'All issues' })).findByRole('link', { name: 'Dairy chiller 2 at 9°C' }))
  const detail = await screen.findByRole('region', { name: 'Issue detail' })
  await user.click(within(detail).getByRole('button', { name: 'Reopen' }))
  await user.click(within(detail).getByRole('button', { name: 'Never mind' }))
  expect(within(detail).queryByRole('textbox', { name: 'Reason for reopening' })).not.toBeInTheDocument()
  expect((await read(meena, submitted.row_id)).issue_state).toBe('Closed')
})

test('pressing Enter on an empty corrective task adds nothing', async ({ createUser }) => {
  const { meena } = await team(createUser)
  await meena.post<Row>('/api/save_row', { table: ISSUE, row: issueFields })
  const { user, detail } = await openIssue(meena)
  await user.type(within(detail).getByRole('textbox', { name: 'New corrective task' }), '   {Enter}')
  expect(within(within(detail).getByRole('list', { name: 'Corrective tasks' })).queryAllByRole('listitem')).toEqual([])
  expect(within(detail).queryByRole('alert')).not.toBeInTheDocument()
  expect((await meena.get<{ data: Row[] }>('/api/table/tasker.task')).data).toEqual([])
})

test('Never mind closes the raise form without raising anything', async ({ createUser }) => {
  const { meena } = await team(createUser)
  const user = await openIssues(meena)
  await user.click(await screen.findByRole('button', { name: 'Raise an issue' }))
  const form = await screen.findByRole('form', { name: 'Raise an issue' })
  await user.click(within(form).getByRole('button', { name: 'Never mind' }))
  expect(screen.queryByRole('form', { name: 'Raise an issue' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Raise an issue' })).toBeInTheDocument()
})

test('a severity’s director is saved from the SLA rules page', async ({ createUser }) => {
  const { meena, kumar } = await team(createUser)
  const user = await openRules(meena)
  const critical = within(await screen.findByRole('table', { name: 'SLA rules' })).getByRole('row', { name: /Critical/ })
  const director = within(critical).getByRole('combobox', { name: 'Critical: director' })
  await within(director).findByRole('option', { name: 'Kumar' })
  await user.selectOptions(director, 'Kumar')
  await user.click(within(critical).getByRole('button', { name: 'Save Critical' }))
  await waitFor(async () => expect((await meena.get<{ data: Row[] }>('/api/table/tasker.sla_rule?fields=["severity","director"]')).data)
    .toEqual([{ severity: 'Critical', director: kumar.user }]))
})

test('a store’s manager is saved from the SLA rules page', async ({ createUser }) => {
  const { meena, suresh, store } = await team(createUser)
  const user = await openRules(meena)
  const manager = await within(await screen.findByRole('table', { name: 'Store managers and hours' })).findByRole('combobox', { name: 'ATK Avadi manager' })
  await within(manager).findByRole('option', { name: 'Suresh' })
  await user.selectOptions(manager, 'Suresh')
  await waitFor(async () => expect((await meena.get<Row>(`/api/table/tasker.store/${store.row_id}`)).store_manager).toBe(suresh.user))
})

for (const [field, column, value] of [['opens at', 'opens_at', '08:30'], ['closes at', 'closes_at', '23:00']] as const) {
  test(`a store’s ${field} time is saved when you leave the field`, async ({ createUser }) => {
    const { meena, store } = await team(createUser)
    const user = await openRules(meena)
    const input = await within(await screen.findByRole('table', { name: 'Store managers and hours' })).findByRole('textbox', { name: `ATK Avadi ${field}` })
    await user.clear(input)
    await user.type(input, value)
    await user.tab()
    await waitFor(async () => expect((await meena.get<Row>(`/api/table/tasker.store/${store.row_id}`))[column]).toBe(value))
  })
}
