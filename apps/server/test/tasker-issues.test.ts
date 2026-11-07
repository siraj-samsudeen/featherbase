import { resolve } from 'node:path'
import { expect, vi } from 'vitest'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { enqueue, drainJobs } from '../src/jobs'
import { sql } from '../src/db'
import { taskerClient } from './tasker-client'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
type LogEntry = { kind: string; to?: string[]; by?: string; note?: string }
const ISSUE = 'tasker.issue'
// Monday 09-Nov-2026, written in IST.
const at = (ist: string) => new Date(`${ist}+05:30`)

async function escalate() {
  await enqueue('tasker.escalate_issues', {})
  await sql`update background_job set run_at = now() - interval '1 second' where job_status = 'queued'`
  await drainJobs()
}

async function withTime<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] })
  try { vi.setSystemTime(when); return await fn() } finally { vi.useRealTimers() }
}

async function setup(createUser: (options: { roles: string[]; fullName?: string }) => Promise<Parameters<typeof taskerClient>[0]>, { manager = true, head = true } = {}) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const meena = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Meena' }))
  const suresh = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Suresh' }))
  const kumar = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Kumar' }))
  const store = await meena.post<Row>('/api/save_row', { table: 'tasker.store', row: { store_name: 'ATK Avadi', ...(manager ? { store_manager: meena.user } : {}) } })
  if (head) await meena.post('/api/save_row', { table: 'tasker.function_head', row: { owner_function: 'Facilities', head: kumar.user } })
  return { meena, suresh, kumar, store }
}
type Team = Awaited<ReturnType<typeof setup>>
type Client = Team['meena']
const raise = (client: Client, row: Record<string, unknown>) => client.post<Row>('/api/save_row', { table: ISSUE, row: {
  issue_title: 'Dairy chiller 2 at 9°C', category: 'Equipment failure', severity: 'High', owner_function: 'Facilities', ...row } })
const change = (client: Client, issue: Row, values: Record<string, unknown>) =>
  client.post<Row>('/api/save_row', { table: ISSUE, row: { row_id: issue.row_id, updated_at: issue.updated_at, ...values } })
const read = (client: Client, issue: Row) => client.get<Row>(`/api/table/${ISSUE}/${issue.row_id}`)
const log = (issue: Row) => JSON.parse(String(issue.issue_log || '[]')) as LogEntry[]
const kinds = (issue: Row) => log(issue).map(entry => entry.kind)

test('a raised issue takes its deadlines from the SLA rule, and a category rule wins', async ({ createUser }) => {
  const { meena, store } = await setup(createUser)
  const issue = await withTime(at('2026-11-09T21:00'), () => raise(meena, { store: store.row_id }))
  expect(issue).toMatchObject({ issue_state: 'Open', clock: 'Store hours', respond_minutes: 60, fix_minutes: 1440, opens_at: '09:00', closes_at: '22:00' })
  // 1 hour from 21:00 in store hours: 21:00–22:00. 1 day (1440 minutes): 60 tonight, 720 Tuesday, 660 Wednesday.
  expect(new Date(String(issue.respond_by)).getTime()).toBe(at('2026-11-09T22:00').getTime())
  expect(new Date(String(issue.fix_by)).getTime()).toBe(at('2026-11-11T20:00').getTime())
  expect(kinds(issue)).toEqual(['raised'])
  await meena.post('/api/save_row', { table: 'tasker.sla_rule', row: { severity: 'High', category: 'Cash shortage', respond_minutes: 15, fix_minutes: 120, clock: 'Round the clock' } })
  const cash = await withTime(at('2026-11-09T21:00'), () => raise(meena, { store: store.row_id, category: 'Cash shortage', issue_title: 'Till 3 short by ₹4,000' }))
  expect(cash).toMatchObject({ clock: 'Round the clock', fix_minutes: 120 })
  expect(new Date(String(cash.fix_by)).getTime()).toBe(at('2026-11-09T23:00').getTime())
})

test('only the owner acknowledges, and a late acknowledgement records the missed response', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user }))
  expect(log(issue).find(entry => entry.kind === 'assigned')).toMatchObject({ to: [suresh.user] })
  await expect(change(meena, issue, { issue_state: 'Acknowledged' })).rejects.toThrow('Only the owner can acknowledge this issue')
  const acknowledged = await withTime(at('2026-11-09T11:30'), () => change(suresh, issue, { issue_state: 'Acknowledged' }))
  expect(acknowledged).toMatchObject({ issue_state: 'Acknowledged', response_breached: true })
  expect(kinds(acknowledged)).toContain('acknowledged')
})

test('the job reminds the owner at 75% and escalates at breach, each once', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, severity: 'Critical' }))
  // Critical: 4 hours round the clock; 75% is 13:00, breach is 14:00, the director 2 hours later.
  await withTime(at('2026-11-09T13:10'), escalate)
  await withTime(at('2026-11-09T13:20'), escalate)
  let now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'reminder')).toEqual([expect.objectContaining({ to: [suresh.user] })])
  expect(now).toMatchObject({ fix_breached: false, used_pct: 83 })
  await withTime(at('2026-11-09T14:05'), escalate)
  await withTime(at('2026-11-09T14:15'), escalate)
  now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'breach')).toEqual([expect.objectContaining({ to: [meena.user, kumar.user] })])
  expect(now).toMatchObject({ fix_breached: true, needs_owner: false })
  // No director is named for Critical, so the next step has no one to go to.
  await withTime(at('2026-11-09T16:10'), escalate)
  now = await read(meena, issue)
  expect(now.needs_owner).toBe(true)
  expect(log(now).find(entry => entry.kind === 'missing')?.note).toMatch(/director/)
})

test('a Critical breach reaches the director after the rule’s wait', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  await meena.post('/api/save_row', { table: 'tasker.sla_rule', row: { severity: 'Critical', respond_minutes: 15, fix_minutes: 240, clock: 'Round the clock', director: kumar.user, director_after_minutes: 120 } })
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, severity: 'Critical' }))
  await withTime(at('2026-11-09T14:05'), escalate)
  await withTime(at('2026-11-09T15:00'), escalate)
  expect(kinds(await read(meena, issue))).not.toContain('director')
  await withTime(at('2026-11-09T16:10'), escalate)
  await withTime(at('2026-11-09T16:20'), escalate)
  const now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'director')).toEqual([expect.objectContaining({ to: [kumar.user] })])
  expect(now.needs_owner).toBe(false)
})

test('an issue with no owner, or no one to escalate to, needs an owner', async ({ createUser }) => {
  const { meena, store } = await setup(createUser, { manager: false, head: false })
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id }))
  expect(issue.needs_owner).toBe(true)
  const owned = await change(meena, issue, { owner: meena.user })
  expect(owned.needs_owner).toBe(false)
  await withTime(at('2026-11-11T21:00'), escalate)
  const now = await read(meena, issue)
  expect(now).toMatchObject({ fix_breached: true, needs_owner: true })
  expect(log(now).find(entry => entry.kind === 'missing')?.note).toMatch(/store manager.*Facilities head/)
})

test('waiting for a vendor pauses the clock only once the store manager approves', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user }))
  await expect(change(suresh, issue, { pause_requested: true })).rejects.toThrow('Give a reason and a next review date')
  const asked = await withTime(at('2026-11-09T11:00'), () => change(suresh, issue, { pause_requested: true, pause_reason: 'Blue Star visit booked', pause_review_on: '2026-11-10' }))
  expect(asked).toMatchObject({ paused: false, pause_requested: true })
  await expect(change(suresh, asked, { paused: true })).rejects.toThrow('Only the store manager can approve a pause')
  const paused = await withTime(at('2026-11-09T12:00'), () => change(meena, asked, { paused: true }))
  expect(paused).toMatchObject({ paused: true, on_clock_minutes: 120 })
  const resumed = await withTime(at('2026-11-09T15:00'), () => change(suresh, paused, { paused: false }))
  expect(resumed).toMatchObject({ paused: false, pause_requested: false, paused_minutes: 180, on_clock_minutes: 120 })
  expect(kinds(resumed)).toEqual(expect.arrayContaining(['pause_requested', 'paused', 'resumed']))
  expect(new Date(String(resumed.fix_by)).getTime()).toBe(at('2026-11-10T21:00').getTime())
})

test('closure: submit with a note, the verifier accepts or returns, and a breach stays recorded', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('2026-11-09T10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user, severity: 'Critical' }))
  await expect(change(meena, issue, { verifier: suresh.user })).rejects.toThrow('The verifier can’t be the issue’s owner')
  await withTime(at('2026-11-09T14:30'), escalate)
  const breached = await read(suresh, issue)
  await expect(change(suresh, breached, { issue_state: 'Submitted for verification' })).rejects.toThrow('Add a note on what was done')
  const submitted = await withTime(at('2026-11-09T15:00'), () => change(suresh, breached, { issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced; 3°C after an hour' }))
  expect(submitted).toMatchObject({ issue_state: 'Submitted for verification', submitted_by: suresh.user, fix_breached: true })
  await expect(change(suresh, submitted, { issue_state: 'Closed' })).rejects.toThrow('Only the verifier can accept this issue')
  await expect(change(meena, submitted, { issue_state: 'Acknowledged' })).rejects.toThrow('Give a reason for returning this issue')
  const returned = await withTime(at('2026-11-09T16:00'), () => change(meena, submitted, { issue_state: 'Acknowledged', change_reason: 'Still 7°C at the back' }))
  expect(returned).toMatchObject({ issue_state: 'Acknowledged', return_reason: 'Still 7°C at the back', return_count: 1, paused_minutes: 60 })
  const again = await change(suresh, returned, { issue_state: 'Submitted for verification', evidence_note: 'Fan motor replaced too' })
  const closed = await change(meena, again, { issue_state: 'Closed' })
  expect(closed).toMatchObject({ issue_state: 'Closed', verified_by: meena.user, fix_breached: true })
  const reopened = await change(meena, closed, { issue_state: 'Acknowledged', change_reason: 'Failed again overnight' })
  expect(reopened).toMatchObject({ issue_state: 'Acknowledged', fix_breached: true, verified_by: null })
  expect(kinds(reopened)).toEqual(expect.arrayContaining(['submitted', 'returned', 'closed', 'reopened']))
})

test('without a verifier, the owner’s submission closes the issue', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  expect(await change(suresh, issue, { issue_state: 'Submitted for verification', evidence_note: 'Reset the breaker' })).toMatchObject({ issue_state: 'Closed', verified_by: null })
})

test('a corrective task links to its issue, shares it and takes its store', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  const task = await meena.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Call Blue Star for a compressor check', issue: issue.row_id, assigned_to: suresh.user } })
  expect(task).toMatchObject({ issue: issue.row_id, shared: true, store: store.row_id, assigned_to: suresh.user })
})
