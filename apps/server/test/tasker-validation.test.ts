// Exercise the app's exported lifecycle seam with the SAME real document
// capability that the runtime host supplies. Invalid proposals are inputs;
// every referenced task, parent, member and series is a real sandbox row.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test as base } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { installApp } from '../src/apps'
import { callerDocuments } from '../src/runtime-actions'
import { saveDoc, getDoc } from '../src/document'
import { AppError } from '../src/errors'
import { sql } from '../src/db'
import { enqueue, drainJobs } from '../src/jobs'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import type { Context } from '../../../example-apps/tasker/src/server'

type Row = Record<string, unknown>
type Runtime = typeof import('../../../example-apps/tasker/src/server')
const tables = ['tasker.task', 'tasker.project', 'tasker.discussion', 'tasker.recurrence']
const now = '2027-03-14T12:00:00.000Z'
interface Fixture {
  runtime: Runtime
  user: string
  task: Row
  project: Row
  hook(row: Row, old?: Row, isNew?: boolean): Context
  save(table: string, row: Row): Promise<Row>
  action(payload: unknown): Parameters<Runtime['actions']['start_recurrence']>[0]
}
const test = base.extend<{ tasker: Fixture }>({
  tasker: async ({ createUser }, use) => {
    const root = resolve('../..', 'example-apps/tasker')
    expect(await discoverPackages([root])).toEqual([])
    await installApp('tasker')
    const person = await createUser({ roles: ['Tasker Member'] })
    const user = person.user!
    const access = callerDocuments('tasker', tables, user)
    const runtime = await import(/* @vite-ignore */ pathToFileURL(resolve(root, 'dist/server.mjs')).href) as Runtime
    const save = (table: string, row: Row) => saveDoc(table, row, user)
    const project = await save('tasker.project', { project_name: 'Lifecycle validation work' })
    const task = await save('tasker.task', { task_title: 'Review the real stock count' })
    const reject = (message: string, fields?: Record<string, string>): never => { throw new AppError('ValidationError', message, fields) }
    try {
      await use({ runtime, user, task, project, save,
        hook: (row, old, isNew = !old) => ({ user, now, timeZone: 'UTC', row, old, isNew, documents: access.documents, reject }),
        action: payload => ({ user, payload, documents: access.documents, reject }),
      })
    } finally { await access.close() }
  },
})

const proposed = (task: Row, extra: Row = {}) => ({ ...task, ...extra })
const instructions = JSON.stringify({ task: { task_title: 'Weekly review' }, subtasks: [] })
const recurrence = (task: Row, extra: Row = {}) => ({ schedule_mode: 'daily', interval: 1, anchor_date: '2027-03-01', snapshot: instructions, active_task: task.row_id, ...extra })

test('a proposed occurrence cannot omit its series', async ({ tasker: f }) => {
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Orphan', occurrence_key: 'missing:2027' }))).rejects.toThrow('An occurrence belongs to its recurring series')
})

test.for([
  ['personal_tasks_owner', 'Private tasks belong only to their creator'],
  ['assigned_to', 'Share this task in a project before assigning it to someone else'],
])('a private proposal refuses a foreign %s', async ([field, message], { tasker: f }) => {
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(f.task, { [field]: 'another person' }), f.task))).rejects.toThrow(message)
})

test('shared project work cannot return to the private Inbox', async ({ tasker: f }) => {
  const shared = await f.save('tasker.task', proposed(f.task, { project: f.project.row_id }))
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(shared, { project: null }), shared))).rejects.toThrow('Shared work stays in a shared project')
})

test('a subtask proposal cannot change its parent', async ({ tasker: f }) => {
  const child = await f.save('tasker.task', { task_title: 'Count crates', parent_task: f.task.row_id })
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(child, { parent_task: null }), child))).rejects.toThrow('A subtask cannot be moved to another parent')
})

test('a proposed task cannot parent itself', async ({ tasker: f }) => {
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(f.task, { parent_task: f.task.row_id }), undefined, true))).rejects.toThrow('A task cannot be its own parent')
})

test('a subtask proposal cannot specify a different shared project', async ({ tasker: f }) => {
  const other = await f.save('tasker.project', { project_name: 'Other shared workspace' })
  const shared = await f.save('tasker.task', proposed(f.task, { project: f.project.row_id }))
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Misplaced child', parent_task: shared.row_id, project: other.row_id }))).rejects.toThrow('A subtask belongs to its parent’s project')
})

test('a subtask proposal cannot choose a different personal owner', async ({ tasker: f }) => {
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Misowned child', parent_task: f.task.row_id, personal_tasks_owner: 'another person' }))).rejects.toThrow('A subtask inherits its parent’s privacy')
})

test('a shared subtask proposal refuses a person outside the member directory', async ({ tasker: f }) => {
  const shared = await f.save('tasker.task', proposed(f.task, { project: f.project.row_id }))
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Unassignable child', parent_task: shared.row_id, assigned_to: 'not a member' }))).rejects.toThrow('Choose a Tasker member for this subtask')
})

test.for([
  [{ body: '' }, 'Write a message first'],
  [{ body: null }, 'Write a message first'],
  [{ kind: 'Reply' }, 'Choose the message you are replying to'],
  [{ parent_message: 'unexpected' }, 'Only a reply can name a parent message'],
  [{ resolved: true }, 'Only questions have a respondent and resolution'],
  [{ reply_needed_from: 'unexpected' }, 'Only questions have a respondent and resolution'],
  [{ kind: 'Question', resolved: true }, 'A new question starts waiting for a reply'],
  [{ kind: 'Question', reply_needed_from: 'not a member' }, 'Choose a current team member or Anyone'],
] as const)('a malformed discussion proposal %j is refused', async ([extra, message], { tasker: f }) => {
  await expect(f.runtime.validators['tasker.discussion'](f.hook({ task: f.task.row_id, body: 'Stock question', kind: 'Update', ...extra }))).rejects.toThrow(message)
})

test('a discussion proposal cannot move an existing message', async ({ tasker: f }) => {
  const message = await f.save('tasker.discussion', { task: f.task.row_id, body: 'Keep this update', kind: 'Update' })
  await expect(f.runtime.validators['tasker.discussion'](f.hook(proposed(message, { task: 'other' }), message))).rejects.toThrow('A message stays with its original task')
})

test('a resolved question must reopen before accepting a new reply', async ({ tasker: f }) => {
  const question = await f.save('tasker.discussion', { task: f.task.row_id, body: 'Is it counted?', kind: 'Question' })
  const resolved = await f.save('tasker.discussion', proposed(question, { resolved: true }))
  await expect(f.runtime.validators['tasker.discussion'](f.hook({ task: f.task.row_id, body: 'Yes', kind: 'Reply', parent_message: resolved.row_id }))).rejects.toThrow('Reopen this question before replying')
})

test('editing a reply retains its original question cycle', async ({ tasker: f }) => {
  const question = await f.save('tasker.discussion', { task: f.task.row_id, body: 'Is it counted?', kind: 'Question' })
  const reply = await f.save('tasker.discussion', { task: f.task.row_id, body: 'Yes', kind: 'Reply', parent_message: question.row_id })
  const row = proposed(reply, { body: 'Yes, all crates' })
  await f.runtime.validators['tasker.discussion'](f.hook(row, reply))
  expect(row).toMatchObject({ body: 'Yes, all crates', reply_cycle: reply.reply_cycle })
})

test.for([null, {}, { row_id: 37 }, { row_id: 'task' }])('starting recurrence rejects malformed task selection %j', async (payload, { tasker: f }) => {
  await expect(f.runtime.actions.start_recurrence(f.action(payload))).rejects.toThrow('Choose a task and its current revision')
})

test('starting recurrence refuses an obsolete task revision', async ({ tasker: f }) => {
  await expect(f.runtime.actions.start_recurrence(f.action({ row_id: f.task.row_id, updated_at: 'obsolete' }))).rejects.toThrow('This task changed')
})

test('a subtask cannot start its own recurring series', async ({ tasker: f }) => {
  const child = await f.save('tasker.task', { task_title: 'Subtask count', parent_task: f.task.row_id })
  const current = await f.action(null).documents.get('tasker.task', String(child.row_id))
  await expect(f.runtime.actions.start_recurrence(f.action({ row_id: child.row_id, updated_at: current.updated_at }))).rejects.toThrow('Repeat the parent task')
})

test.for(['pause_recurrence', 'resume_recurrence'] as const)('%s requires a series selection', async (name, { tasker: f }) => {
  await expect(f.runtime.actions[name](f.action(null))).rejects.toThrow('Choose a recurring series')
  await expect(f.runtime.actions[name](f.action({ row_id: 37 }))).rejects.toThrow('Choose a recurring series')
})

test('pause and resume preserve the series identity', async ({ tasker: f }) => {
  const series = await f.save('tasker.recurrence', recurrence(f.task))
  expect(await f.runtime.actions.pause_recurrence(f.action({ row_id: series.row_id }))).toEqual({ paused: true })
  expect(await getDoc('tasker.recurrence', String(series.row_id), f.user)).toMatchObject({ paused: true })
  expect(await f.runtime.actions.resume_recurrence(f.action({ row_id: series.row_id }))).toEqual({ paused: false })
  expect(await getDoc('tasker.recurrence', String(series.row_id), f.user)).toMatchObject({ paused: false, active_task: f.task.row_id })
})

test.for([
  [{ schedule_mode: 'yearly' }, 'Choose how this task repeats'],
  [{ snapshot: 'null' }, 'This recurring task has invalid instructions'],
  [{ snapshot: '{}' }, 'This recurring task has invalid instructions'],
  [{ snapshot: '{"task":{}}' }, 'This recurring task has invalid instructions'],
  [{ snapshot: '{"task":{"task_title":37},"subtasks":[]}' }, 'This recurring task has invalid instructions'],
  [{ snapshot: '{"task":{"task_title":"Count"},"subtasks":[null]}' }, 'This recurring task has invalid instructions'],
  [{ snapshot: '{"task":{"task_title":"Count"},"subtasks":[{}]}' }, 'This recurring task has invalid instructions'],
  [{ active_task: null }, 'Choose the first task in this series'],
] as const)('an invalid recurring proposal %j is refused', async ([extra, message], { tasker: f }) => {
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(recurrence(f.task, extra)))).rejects.toThrow(message)
})

async function recurring(f: Fixture, task: Row = f.task) {
  const current = await f.action(null).documents.get('tasker.task', String(task.row_id))
  const { seriesId } = await f.runtime.actions.start_recurrence(f.action({ row_id: current.row_id, updated_at: current.updated_at,
    schedule_mode: 'daily', interval: 1, anchor_date: '2027-03-01' }))
  return { series: await getDoc('tasker.recurrence', seriesId, f.user), task: await getDoc('tasker.task', String(task.row_id), f.user) }
}

test('an existing recurring task cannot start another series', async ({ tasker: f }) => {
  const existing = await recurring(f)
  const current = await f.action(null).documents.get('tasker.task', String(existing.task.row_id))
  await expect(f.runtime.actions.start_recurrence(f.action({ row_id: current.row_id, updated_at: current.updated_at }))).rejects.toThrow('already belongs to a recurring series')
})

test('a recurring task cannot switch series', async ({ tasker: f }) => {
  const first = await recurring(f)
  const otherTask = await f.save('tasker.task', { task_title: 'Other count' })
  const second = await recurring(f, otherTask)
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(first.task, { recurrence: second.series.row_id }), first.task))).rejects.toThrow('original recurring series')
})

test('a recurring task cannot detach from its series', async ({ tasker: f }) => {
  const { task } = await recurring(f)
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(task, { recurrence: null }), task))).rejects.toThrow('original recurring series')
})

test('a different task cannot claim an existing series', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  const other = await f.save('tasker.task', { task_title: 'Another count' })
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(other, { recurrence: series.row_id }), other))).rejects.toThrow('This series belongs to another task')
})

test('an occurrence cannot be created before its scheduled instant', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Premature count', recurrence: series.row_id }))).rejects.toThrow('Choose the next scheduled occurrence')
})

test('a new recurring occurrence cannot bypass active work', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  const due = new Date(Date.now() - 86_400_000).toISOString()
  // Model a persisted schedule that was due while an earlier task stayed open.
  await sql`update tasker.recurrence set next_at = ${due} where row_id = ${String(series.row_id)}`
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Overlapping count', recurrence: series.row_id,
    occurrence_key: `${series.row_id}:${due}` }))).rejects.toThrow('This series already has active work')
})

test('a newly generated occurrence must start unfinished', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const due = new Date(Date.now() - 86_400_000).toISOString()
  await sql`update tasker.recurrence set next_at = ${due} where row_id = ${String(series.row_id)}`
  await expect(f.runtime.validators['tasker.task'](f.hook({ task_title: 'Pre-completed count', recurrence: series.row_id,
    occurrence_key: `${series.row_id}:${due}`, task_state: 'Done' }))).rejects.toThrow('A new occurrence starts unfinished')
})

test('reopening the current occurrence checks for other unfinished work', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  const done = await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const proposal = proposed(done, { task_state: 'Not started', is_done: false })
  await f.runtime.validators['tasker.task'](f.hook(proposal, done))
  expect(proposal.completed_at).toBeNull()
  expect(proposal.recurrence).toBe(series.row_id)
})

test('a child discussion inherits the root privacy boundary', async ({ tasker: f }) => {
  const child = await f.save('tasker.task', { task_title: 'Child count', parent_task: f.task.row_id })
  const proposal = { task: child.row_id, body: 'Check the count', kind: 'Question', reply_needed_from: f.user }
  await f.runtime.validators['tasker.discussion'](f.hook(proposal))
  expect(proposal).toMatchObject({ task: child.row_id, reply_cycle: 0 })
})

test('removing an inherited project from a subtask is refused', async ({ tasker: f }) => {
  const shared = await f.save('tasker.task', proposed(f.task, { project: f.project.row_id }))
  const child = await f.save('tasker.task', { task_title: 'Project child', parent_task: shared.row_id })
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(child, { project: null }), child))).rejects.toThrow('A subtask belongs to its parent’s project')
})

test('a private subtask cannot be moved into a project independently', async ({ tasker: f }) => {
  const child = await f.save('tasker.task', { task_title: 'Private child', parent_task: f.task.row_id })
  await expect(f.runtime.validators['tasker.task'](f.hook(proposed(child, { project: f.project.row_id }), child))).rejects.toThrow('A subtask belongs to its parent’s project')
})

test('a shared recurring series cannot be made private again', async ({ tasker: f }) => {
  const shared = await f.save('tasker.task', proposed(f.task, { project: f.project.row_id }))
  const { series } = await recurring(f, shared)
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(proposed(series, { shared: false }), series))).rejects.toThrow('A shared recurring series cannot become private')
})

test('a recurring series cannot abandon unfinished active work', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(proposed(series, { active_task: null }), series))).rejects.toThrow('Finish the active occurrence')
})

test('a series refuses a next active task from another series', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const other = await f.save('tasker.task', { task_title: 'Unrelated task' })
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(proposed(series, { active_task: other.row_id }), series))).rejects.toThrow('The active task must be an occurrence')
})

test('a new series refuses a child as its active task', async ({ tasker: f }) => {
  const child = await f.save('tasker.task', { task_title: 'Child repeat', parent_task: f.task.row_id })
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(recurrence(child)))).rejects.toThrow('Choose a parent task')
})

test('a new series refuses a task already assigned to a series', async ({ tasker: f }) => {
  const { task } = await recurring(f)
  await expect(f.runtime.validators['tasker.recurrence'](f.hook(recurrence(task)))).rejects.toThrow('Choose a parent task')
})

test('a completed occurrence must retain its completion instant', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  await sql`update tasker.task set completed_at = null where row_id = ${String(task.row_id)}`
  await expect(f.runtime.validators['tasker.recurrence'](f.hook({ ...series }, series))).rejects.toThrow('A completed occurrence needs its completion time')
})

test.for([true, false])('an idle series normalizes its next run with paused=%s', async (paused, { tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const proposal = proposed(series, { active_task: null, paused })
  await f.runtime.validators['tasker.recurrence'](f.hook(proposal, series))
  expect(proposal.next_at).toBe(paused ? null : '2027-03-15T00:00:00.000Z')
})

test('an idle series keeps its already scheduled next occurrence', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const old = proposed(series, { next_at: '2027-04-01T00:00:00.000Z' })
  const proposal = proposed(old, { active_task: null })
  await f.runtime.validators['tasker.recurrence'](f.hook(proposal, old))
  expect(proposal.next_at).toBe('2027-04-01T00:00:00.000Z')
})

async function runRepeats() {
  const job = await enqueue('tasker.repeat_tasks', {}, { maxAttempts: 1 })
  await sql`update background_job set run_at = now() - interval '1 second' where row_id = ${job}`
  await drainJobs()
  return (await sql`select job_status, error from background_job where row_id = ${job}`)[0]
}

test('a series paused after listing is not executed', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  let pauseAtLock = true
  const controller: TableController = { table: 'tasker.recurrence', hooks: { before_lock: async ctx => {
    if (!pauseAtLock || ctx.row.row_id !== series.row_id) return
    pauseAtLock = false
    await sql`update tasker.recurrence set paused = true where row_id = ${String(series.row_id)}`
  } } }
  registerController(controller)
  try {
    expect(await runRepeats()).toMatchObject({ job_status: 'done' })
    expect(await getDoc('tasker.recurrence', String(series.row_id), f.user)).toMatchObject({ paused: true, active_task: f.task.row_id })
  } finally { unregisterController(controller) }
})

test('the scheduler refuses a historical completion with no completion instant', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  await sql`update tasker.task set completed_at = null where row_id = ${String(task.row_id)}`
  expect(await runRepeats()).toMatchObject({ job_status: 'failed', error: 'A completed recurring task needs its completion time' })
  expect(await getDoc('tasker.recurrence', String(series.row_id), f.user)).toMatchObject({ active_task: task.row_id, next_at: null })
})

test('an idle series with no next run schedules a future occurrence', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  await sql`update tasker.recurrence set active_task = null where row_id = ${String(series.row_id)}`
  expect(await runRepeats()).toMatchObject({ job_status: 'done' })
  const scheduled = await getDoc('tasker.recurrence', String(series.row_id), f.user)
  expect(Date.parse(String(scheduled.next_at))).toBeGreaterThan(Date.now())
  expect(scheduled.active_task).toBeNull()
})

test('an idle series does not run its next occurrence early', async ({ tasker: f }) => {
  const { series } = await recurring(f)
  const future = new Date(Math.ceil((Date.now() + 86400_000) / 1000) * 1000).toISOString()
  await sql`update tasker.recurrence set active_task = null, next_at = ${future} where row_id = ${String(series.row_id)}`
  expect(await runRepeats()).toMatchObject({ job_status: 'done' })
  const scheduled = await getDoc('tasker.recurrence', String(series.row_id), f.user)
  expect(new Date(String(scheduled.next_at)).toISOString()).toBe(future)
  expect(scheduled.active_task).toBeNull()
})

test('an idle series creates its due occurrence without a previous active reference', async ({ tasker: f }) => {
  const { series, task } = await recurring(f)
  await f.save('tasker.task', proposed(task, { task_state: 'Done' }))
  const past = new Date(Date.now() - 86400_000).toISOString()
  await sql`update tasker.recurrence set active_task = null, next_at = ${past} where row_id = ${String(series.row_id)}`
  expect(await runRepeats()).toMatchObject({ job_status: 'done' })
  const scheduled = await getDoc('tasker.recurrence', String(series.row_id), f.user)
  expect(scheduled.active_task).not.toBe(task.row_id)
  const next = await getDoc('tasker.task', String(scheduled.active_task), f.user)
  expect(next).toMatchObject({ task_title: task.task_title, task_state: 'Not started', occurrence_key: `${series.row_id}:${past}` })
})

test('saving an old completed row without a completion instant repairs that instant', async ({ tasker: f }) => {
  const done = await f.save('tasker.task', proposed(f.task, { task_state: 'Done' }))
  await sql`update tasker.task set completed_at = null where row_id = ${String(done.row_id)}`
  const old = await getDoc('tasker.task', String(done.row_id), f.user)
  const proposal = { ...old }
  await f.runtime.validators['tasker.task'](f.hook(proposal, old))
  expect(proposal.completed_at).toBe(now)
})

test('recurrence snapshots include children beyond the first page', async ({ tasker: f }) => {
  // Real rows supplied through the same table and owner boundary; a bulk fixture
  // keeps the pagination promise cheap without simulating a document response.
  await sql`insert into tasker.task (row_id, created_by, updated_by, task_title, parent_task, shared)
    select 'child-page-' || i, ${f.user}, ${f.user}, 'Count crate ' || i, ${String(f.task.row_id)}, false from generate_series(1, 201) as i`
  const { series } = await recurring(f)
  const snapshot = JSON.parse(String(series.snapshot)) as { subtasks: { task_title: string }[] }
  expect(snapshot.subtasks).toHaveLength(201)
  expect(snapshot.subtasks.map(child => child.task_title)).toContain('Count crate 201')
})


test('a Date-valued authored anchor is validated at the lifecycle seam', async ({ tasker: f }) => {
  const proposal = recurrence(f.task, { anchor_date: new Date('2027-03-01T00:00:00.000Z') })
  await f.runtime.validators['tasker.recurrence'](f.hook(proposal))
  expect(JSON.parse(String(proposal.snapshot))).toMatchObject({ task: { task_title: f.task.task_title }, subtasks: [] })
})
