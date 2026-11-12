import { resolve } from 'node:path'
import { makeJobDue } from './jobs-due'
import { expect } from 'vitest'
import { withTime } from './clock'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { enqueue, drainJobs } from '../src/jobs'
import { sql } from '../src/db'
import { taskerClient } from './tasker-client'
import { saveDoc } from '../src/document'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
type LogEntry = { kind: string; to?: string[]; by?: string; note?: string }
const ISSUE = 'tasker.issue'
const DAY = 86_400_000
// The day the tests take place: tomorrow in India, from the real clock, so the times never go
// stale. Store hours are the same every day, so which weekday it falls on does not matter.
const firstDay = new Date(Date.now() + 330 * 60_000 + DAY).toISOString().slice(0, 10)
/** A date `days` after the first day, 'YYYY-MM-DD'. */
const day = (days: number) => new Date(Date.parse(firstDay) + days * DAY).toISOString().slice(0, 10)
/** A time of day in India (IST), `days` after the first day. */
const at = (ist: string, days = 0) => new Date(`${day(days)}T${ist}+05:30`)

/** One run of the escalation job, on the faked clock, waited for. */
async function escalate() {
  // Installing Tasker queues its every-minute jobs. Each scheduled run re-queues itself one
  // minute after the faked clock, which is already due by the database's own clock whenever
  // the faked time is behind real time: draining would then run those for ever and never
  // reach this run. Only this run is wanted, so the scheduled ones are taken off the queue.
  await sql`delete from background_job where job_status = 'queued' and trigger = 'schedule'`
  const job = await enqueue('tasker.escalate_issues', {})
  await makeJobDue(job)
  await drainJobs()
  const [run] = await sql`select job_status, error from background_job where row_id = ${job}`
  expect(run).toMatchObject({ job_status: 'done', error: null })
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
// Saves at a chosen time go through the server's own save, rules included, as that person:
// an HTTP session would expire under the faked clock.
const raise = (client: Client, row: Record<string, unknown>) => saveDoc(ISSUE, {
  issue_title: 'Dairy chiller 2 at 9°C', category: 'Equipment failure', severity: 'High', owner_function: 'Facilities', ...row }, client.user!) as Promise<Row>
const change = (client: Client, issue: Row, values: Record<string, unknown>) =>
  saveDoc(ISSUE, { row_id: issue.row_id, updated_at: issue.updated_at, ...values }, client.user!) as Promise<Row>
const read = (client: Client, issue: Row) => client.get<Row>(`/api/table/${ISSUE}/${issue.row_id}`)
const log = (issue: Row) => JSON.parse(String(issue.issue_log || '[]')) as LogEntry[]
const kinds = (issue: Row) => log(issue).map(entry => entry.kind)

test('a raised issue takes its deadlines from the SLA rule, and a category rule wins', async ({ createUser }) => {
  const { meena, store } = await setup(createUser)
  const issue = await withTime(at('21:00'), () => raise(meena, { store: store.row_id }))
  expect(issue).toMatchObject({ issue_state: 'Open', clock: 'Store hours', respond_minutes: 60, fix_minutes: 1440, opens_at: '09:00', closes_at: '22:00' })
  // 1 hour from 21:00 in store hours: 21:00–22:00. 1 day (1440 minutes): 60 tonight, 780 the next day, 600 the day after.
  expect(new Date(String(issue.respond_by)).getTime()).toBe(at('22:00').getTime())
  expect(new Date(String(issue.fix_by)).getTime()).toBe(at('19:00', 2).getTime())
  expect(kinds(issue)).toEqual(['raised'])
  await meena.post('/api/save_row', { table: 'tasker.sla_rule', row: { severity: 'High', category: 'Cash shortage', respond_minutes: 15, fix_minutes: 120, clock: 'Round the clock' } })
  const cash = await withTime(at('21:00'), () => raise(meena, { store: store.row_id, category: 'Cash shortage', issue_title: 'Till 3 short by ₹4,000' }))
  expect(cash).toMatchObject({ clock: 'Round the clock', fix_minutes: 120 })
  expect(new Date(String(cash.fix_by)).getTime()).toBe(at('23:00').getTime())
})

test('only the owner acknowledges, and a late acknowledgement records the missed response', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user }))
  expect(log(issue).find(entry => entry.kind === 'assigned')).toMatchObject({ to: [suresh.user] })
  await expect(change(meena, issue, { issue_state: 'Acknowledged' })).rejects.toThrow('Only the owner can acknowledge this issue')
  const acknowledged = await withTime(at('11:30'), () => change(suresh, issue, { issue_state: 'Acknowledged' }))
  expect(acknowledged).toMatchObject({ issue_state: 'Acknowledged', response_breached: true })
  expect(kinds(acknowledged)).toContain('acknowledged')
})

test('the job reminds the owner at 75% and escalates at breach, each once', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, severity: 'Critical' }))
  // Critical: 4 hours round the clock; 75% is 13:00, breach is 14:00, the director 2 hours later.
  await withTime(at('13:10'), escalate)
  await withTime(at('13:20'), escalate)
  let now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'reminder')).toEqual([expect.objectContaining({ to: [suresh.user] })])
  expect(now).toMatchObject({ fix_breached: false, used_pct: 83 })
  await withTime(at('14:05'), escalate)
  await withTime(at('14:15'), escalate)
  now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'breach')).toEqual([expect.objectContaining({ to: [meena.user, kumar.user] })])
  expect(now).toMatchObject({ fix_breached: true, needs_owner: false })
  // No director is named for Critical, so the next step has no one to go to.
  await withTime(at('16:10'), escalate)
  now = await read(meena, issue)
  expect(now.needs_owner).toBe(true)
  expect(log(now).find(entry => entry.kind === 'missing')?.note).toMatch(/director/)
})

test('a Critical breach reaches the director after the rule’s wait', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  await meena.post('/api/save_row', { table: 'tasker.sla_rule', row: { severity: 'Critical', respond_minutes: 15, fix_minutes: 240, clock: 'Round the clock', director: kumar.user, director_after_minutes: 120 } })
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, severity: 'Critical' }))
  await withTime(at('14:05'), escalate)
  await withTime(at('15:00'), escalate)
  expect(kinds(await read(meena, issue))).not.toContain('director')
  await withTime(at('16:10'), escalate)
  await withTime(at('16:20'), escalate)
  const now = await read(meena, issue)
  expect(log(now).filter(entry => entry.kind === 'director')).toEqual([expect.objectContaining({ to: [kumar.user] })])
  expect(now.needs_owner).toBe(false)
})

test('an issue with no owner, or no one to escalate to, needs an owner', async ({ createUser }) => {
  const { meena, store } = await setup(createUser, { manager: false, head: false })
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id }))
  expect(issue.needs_owner).toBe(true)
  const owned = await change(meena, issue, { owner: meena.user })
  expect(owned.needs_owner).toBe(false)
  await withTime(at('21:00', 2), escalate)
  const now = await read(meena, issue)
  expect(now).toMatchObject({ fix_breached: true, needs_owner: true })
  expect(log(now).find(entry => entry.kind === 'missing')?.note).toMatch(/store manager.*Facilities head/)
})

test('waiting for a vendor pauses the clock only once the store manager approves', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user }))
  await expect(change(suresh, issue, { pause_requested: true })).rejects.toThrow('Give a reason and a next review date')
  const asked = await withTime(at('11:00'), () => change(suresh, issue, { pause_requested: true, pause_reason: 'Blue Star visit booked', pause_review_on: day(1) }))
  expect(asked).toMatchObject({ paused: false, pause_requested: true })
  await expect(change(suresh, asked, { paused: true })).rejects.toThrow('Only the store manager can approve a pause')
  const paused = await withTime(at('12:00'), () => change(meena, asked, { paused: true }))
  expect(paused).toMatchObject({ paused: true, on_clock_minutes: 120 })
  const resumed = await withTime(at('15:00'), () => change(suresh, paused, { paused: false }))
  expect(resumed).toMatchObject({ paused: false, pause_requested: false, paused_minutes: 180, on_clock_minutes: 120 })
  expect(kinds(resumed)).toEqual(expect.arrayContaining(['pause_requested', 'paused', 'resumed']))
  // 1 day of store hours from 10:00 ends 21:00 the next day; the 3 paused hours move it to 11:00 the day after.
  expect(new Date(String(resumed.fix_by)).getTime()).toBe(at('11:00', 2).getTime())
})

test('closure: submit with a note, the verifier accepts or returns, and a breach stays recorded', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user, severity: 'Critical' }))
  await expect(change(meena, issue, { verifier: suresh.user })).rejects.toThrow('The verifier can’t be the issue’s owner')
  await withTime(at('14:30'), escalate)
  const breached = await read(suresh, issue)
  await expect(change(suresh, breached, { issue_state: 'Submitted for verification' })).rejects.toThrow('Add a note on what was done')
  const submitted = await withTime(at('15:00'), () => change(suresh, breached, { issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced; 3°C after an hour' }))
  expect(submitted).toMatchObject({ issue_state: 'Submitted for verification', submitted_by: suresh.user, fix_breached: true })
  await expect(change(suresh, submitted, { issue_state: 'Closed' })).rejects.toThrow('Only the verifier can accept this issue')
  await expect(change(meena, submitted, { issue_state: 'Acknowledged' })).rejects.toThrow('Give a reason for returning this issue')
  const returned = await withTime(at('16:00'), () => change(meena, submitted, { issue_state: 'Acknowledged', change_reason: 'Still 7°C at the back' }))
  expect(returned).toMatchObject({ issue_state: 'Acknowledged', return_reason: 'Still 7°C at the back', return_count: 1, paused_minutes: 60 })
  const again = await change(suresh, returned, { issue_state: 'Submitted for verification', evidence_note: 'Fan motor replaced too' })
  const closed = await change(meena, again, { issue_state: 'Closed' })
  expect(closed).toMatchObject({ issue_state: 'Closed', verified_by: meena.user, fix_breached: true })
  const reopened = await change(meena, closed, { issue_state: 'Acknowledged', change_reason: 'Failed again overnight' })
  expect(reopened).toMatchObject({ issue_state: 'Acknowledged', fix_breached: true, verified_by: null })
  expect(kinds(reopened)).toEqual(expect.arrayContaining(['submitted', 'returned', 'closed', 'reopened']))
})

test('an open issue cannot be closed without being submitted first', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  await expect(change(meena, issue, { issue_state: 'Closed' })).rejects.toThrow('Submit this issue for verification first')
  expect((await read(meena, issue)).issue_state).toBe('Open')
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

test('clearing an open issue’s state leaves it Open', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  expect(await change(meena, issue, { issue_state: null })).toMatchObject({ issue_state: 'Open', acknowledged_at: null })
})

test('an issue with no store runs on default store hours, and its escalation says no store manager was told', async ({ createUser }) => {
  const { meena, suresh, kumar } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { owner: suresh.user }))
  expect(issue).toMatchObject({ store: null, clock: 'Store hours', opens_at: '09:00', closes_at: '22:00' })
  await withTime(at('21:00', 3), escalate)
  const now = await read(meena, issue)
  expect(now).toMatchObject({ fix_breached: true, needs_owner: true })
  expect(log(now).find(entry => entry.kind === 'breach')).toMatchObject({ to: [kumar.user] })
  expect(log(now).find(entry => entry.kind === 'missing')?.note).toBe('Escalation has no store manager for this issue')
})

test('giving an issue a new owner keeps its verifier and tells the new owner', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  const handedOver = await change(meena, issue, { owner: kumar.user })
  expect(handedOver).toMatchObject({ issue_state: 'Open', owner: kumar.user, verifier: meena.user })
  expect(log(handedOver).filter(entry => entry.kind === 'assigned').map(entry => entry.to)).toEqual([[suresh.user], [kumar.user]])
})

test('giving an acknowledged issue a new owner sends it back to Open for them to acknowledge', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  const acknowledged = await change(suresh, issue, { issue_state: 'Acknowledged' })
  const handedOver = await change(meena, acknowledged, { owner: kumar.user })
  expect(handedOver).toMatchObject({ issue_state: 'Open', owner: kumar.user, verifier: meena.user, acknowledged_at: null })
  expect(log(handedOver).filter(entry => entry.kind === 'assigned').map(entry => entry.to)).toEqual([[suresh.user], [kumar.user]])
  expect(await change(kumar, handedOver, { issue_state: 'Acknowledged' })).toMatchObject({ issue_state: 'Acknowledged', owner: kumar.user })
})

test('only a Tasker member can verify an issue', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  const outsider = await createUser({ roles: [], fullName: 'Visitor' })
  await expect(change(meena, issue, { verifier: outsider.user })).rejects.toThrow('Choose a Tasker member')
  expect(await change(meena, issue, { verifier: kumar.user })).toMatchObject({ owner: suresh.user, verifier: kumar.user })
})

test('only a Tasker member can own an issue', async ({ createUser }) => {
  const { meena, store } = await setup(createUser)
  const outsider = await createUser({ roles: [], fullName: 'Visitor' })
  await expect(raise(meena, { store: store.row_id, owner: outsider.user })).rejects.toThrow('Choose a Tasker member')
})

test('only the owner submits an issue', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  await expect(change(kumar, issue, { issue_state: 'Submitted for verification', evidence_note: 'Reset the breaker' })).rejects.toThrow('Only the owner submits this issue')
})

test('submitting a paused issue ends the pause and counts the paused time', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user }))
  const asked = await withTime(at('11:00'), () => change(suresh, issue, { pause_requested: true, pause_reason: 'Blue Star visit booked', pause_review_on: day(1) }))
  const paused = await withTime(at('12:00'), () => change(meena, asked, { paused: true }))
  const submitted = await withTime(at('15:00'), () => change(suresh, paused, { issue_state: 'Submitted for verification', evidence_note: 'Blue Star replaced the relay' }))
  expect(submitted).toMatchObject({ paused: false, paused_since: null, pause_requested: false, paused_minutes: 180, on_clock_minutes: 120 })
})

test('editing a paused issue keeps its clock stopped', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user }))
  const asked = await withTime(at('11:00'), () => change(suresh, issue, { pause_requested: true, pause_reason: 'Blue Star visit booked', pause_review_on: day(1) }))
  const paused = await withTime(at('12:00'), () => change(meena, asked, { paused: true }))
  const stored = await read(meena, paused)
  const edited = await withTime(at('15:00'), () => change(meena, stored, { impact: '40 crates of milk at risk' }))
  expect(edited).toMatchObject({ paused: true, impact: '40 crates of milk at risk', on_clock_minutes: 120 })
})

test('the person who submitted an issue can’t verify it, even after it changes hands', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  const submitted = await change(suresh, issue, { issue_state: 'Submitted for verification', evidence_note: 'Reset the breaker' })
  const handedOver = await change(meena, submitted, { owner: kumar.user, verifier: suresh.user })
  await expect(change(suresh, handedOver, { issue_state: 'Closed' })).rejects.toThrow('Nobody verifies an issue they submitted')
})

test('only the verifier returns a submitted issue', async ({ createUser }) => {
  const { meena, suresh, kumar, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user })
  const submitted = await change(suresh, issue, { issue_state: 'Submitted for verification', evidence_note: 'Reset the breaker' })
  await expect(change(kumar, submitted, { issue_state: 'Acknowledged', change_reason: 'Still warm' })).rejects.toThrow('Waiting for the verifier to accept or return this issue')
})

test('reopening a closed issue needs a reason', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  const closed = await change(suresh, issue, { issue_state: 'Submitted for verification', evidence_note: 'Reset the breaker' })
  expect(closed.issue_state).toBe('Closed')
  await expect(change(meena, closed, { issue_state: 'Acknowledged' })).rejects.toThrow('Give a reason for reopening this issue')
})

test('a pause nobody asked for can’t be approved', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  const issue = await raise(meena, { store: store.row_id, owner: suresh.user })
  await expect(change(meena, issue, { paused: true })).rejects.toThrow('Ask for the pause first, with a reason and a next review date')
})

test('an issue submitted after its fix time records the breach', async ({ createUser }) => {
  const { meena, suresh, store } = await setup(createUser)
  // Critical: 4 hours round the clock, so 10:00 breaches at 14:00; no escalation check runs before the submission.
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, owner: suresh.user, verifier: meena.user, severity: 'Critical' }))
  const submitted = await withTime(at('15:00'), () => change(suresh, issue, { issue_state: 'Submitted for verification', evidence_note: 'Compressor relay replaced' }))
  expect(submitted.fix_breached).toBe(true)
  expect(new Date(String(submitted.breached_at)).getTime()).toBe(at('15:00').getTime())
})

test('an issue with no owner moves past 75% without a reminder to anyone', async ({ createUser }) => {
  const { meena, store } = await setup(createUser)
  const issue = await withTime(at('10:00'), () => raise(meena, { store: store.row_id, severity: 'Critical' }))
  await withTime(at('13:10'), escalate)
  const now = await read(meena, issue)
  expect(now).toMatchObject({ escalation_level: 1, used_pct: 79, needs_owner: true })
  expect(kinds(now)).not.toContain('reminder')
})

test('a corrective task for an issue with no store has no store', async ({ createUser }) => {
  const { meena, suresh } = await setup(createUser)
  const issue = await raise(meena, { owner: suresh.user })
  const task = await meena.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Call Blue Star for a compressor check', issue: issue.row_id } })
  expect(task).toMatchObject({ issue: issue.row_id, shared: true, store: null })
})
