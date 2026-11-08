import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { taskerClient } from './tasker-client'

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
const SUBMITTED = 'Submitted for verification'

async function team(createUser: (options: { roles: string[] }) => Promise<Parameters<typeof taskerClient>[0]>) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const meena = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const ravi = taskerClient(await createUser({ roles: ['Tasker Member'] }))
  const project = await meena.post<Row>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Diwali readiness' } })
  return { meena, ravi, project, ids: { meena: meena.user!, ravi: ravi.user! } }
}

type Client = Awaited<ReturnType<typeof team>>['meena']
const save = (client: Client, row: Record<string, unknown>) => client.post<Row>('/api/save_row', { table: 'tasker.task', row })
const change = (client: Client, task: Row, values: Record<string, unknown>) => save(client, { row_id: task.row_id, updated_at: task.updated_at, ...values })

async function assignedAndVerified(createUser: Parameters<typeof team>[0]) {
  const setup = await team(createUser)
  const task = await save(setup.meena, { task_title: 'Fix the billing counter lights', project: setup.project.row_id, assigned_to: setup.ids.ravi, verifier: setup.ids.meena })
  return { ...setup, task }
}

test('a new task takes its project’s default verifier unless that person is its assignee', async ({ createUser }) => {
  const { meena, ravi, project, ids } = await team(createUser)
  await meena.post('/api/save_row', { table: 'tasker.project', row: { row_id: project.row_id, updated_at: project.updated_at, default_verifier: ids.meena } })
  expect(await save(ravi, { task_title: 'Fix the billing counter lights', project: project.row_id, assigned_to: ids.ravi })).toMatchObject({ verifier: ids.meena })
  expect(await save(ravi, { task_title: 'Check the generator', project: project.row_id, assigned_to: ids.meena })).toMatchObject({ verifier: null })
})

test('the verifier can’t be the person doing the task, nor verify private work', async ({ createUser }) => {
  const { meena, project, ids } = await team(createUser)
  await expect(save(meena, { task_title: 'Fix the billing counter lights', project: project.row_id, assigned_to: ids.ravi, verifier: ids.ravi }))
    .rejects.toThrow('The verifier can’t be the person doing the task')
  await expect(save(meena, { task_title: 'My own note', verifier: ids.ravi })).rejects.toThrow('Share this task in a project before asking someone to verify it')
})

test('an assignment waits for the assignee to acknowledge it', async ({ createUser }) => {
  const { meena, ravi, task, ids } = await assignedAndVerified(createUser)
  expect(task.acknowledged_at).toBeNull()
  await expect(change(meena, task, { acknowledged_at: '2026-11-07T00:00:00Z' })).rejects.toThrow('Only the assignee can acknowledge this task')
  const acknowledged = await change(ravi, task, { acknowledged_at: '2026-01-01T00:00:00Z' })
  expect(acknowledged.acknowledged_at).toBeTruthy()
  expect(String(acknowledged.acknowledged_at)).not.toContain('2026-01-01')
  const own = await save(meena, { task_title: 'Book the electrician', project: task.project, assigned_to: ids.meena })
  expect(own.acknowledged_at).toBeTruthy()
  const reassigned = await change(meena, acknowledged, { assigned_to: ids.meena, verifier: null })
  expect(await change(meena, reassigned, { assigned_to: ids.ravi })).toMatchObject({ acknowledged_at: null })
})

test('a task with a verifier is submitted with a note and closed only by its verifier', async ({ createUser }) => {
  const { meena, ravi, task, ids } = await assignedAndVerified(createUser)
  await expect(change(ravi, task, { is_done: true })).rejects.toThrow('Submit this task for verification')
  await expect(change(ravi, task, { task_state: 'Done' })).rejects.toThrow('Submit this task for verification')
  await expect(change(ravi, task, { task_state: SUBMITTED })).rejects.toThrow('Add a note on what was done')
  await expect(change(meena, task, { task_state: SUBMITTED, evidence_note: 'Done myself' })).rejects.toThrow('The verifier can’t submit a task they verify')
  const submitted = await change(ravi, task, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' })
  expect(submitted).toMatchObject({ task_state: SUBMITTED, is_done: false, submitted_by: ids.ravi, evidence_note: 'Replaced both tube lights' })
  expect(submitted.submitted_at).toBeTruthy()
  await expect(change(ravi, submitted, { task_state: 'Done' })).rejects.toThrow('Only the verifier can accept this task')
  await expect(change(ravi, submitted, { task_state: 'In progress' })).rejects.toThrow('Waiting for the verifier')
  const accepted = await change(meena, submitted, { task_state: 'Done' })
  expect(accepted).toMatchObject({ task_state: 'Done', is_done: true, verified_by: ids.meena })
  expect(accepted.verified_at).toBeTruthy()
})

test('the verifier returns a submitted task with a reason, and returns are counted', async ({ createUser }) => {
  const { meena, ravi, task } = await assignedAndVerified(createUser)
  const submitted = await change(ravi, task, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' })
  await expect(change(meena, submitted, { task_state: 'In progress' })).rejects.toThrow('Give a reason for returning this task')
  const returned = await change(meena, submitted, { task_state: 'In progress', change_reason: 'Left counter still flickers' })
  expect(returned).toMatchObject({ task_state: 'In progress', return_reason: 'Left counter still flickers', return_count: 1, change_reason: null })
  const again = await change(ravi, returned, { task_state: SUBMITTED, evidence_note: 'Replaced the starter too' })
  expect(again).toMatchObject({ return_reason: null, return_count: 1 })
  expect(await change(meena, again, { task_state: 'In progress', change_reason: 'Still flickers' })).toMatchObject({ return_count: 2 })
})

test('nobody accepts a task they submitted, and stamped fields can’t be written directly', async ({ createUser }) => {
  const { meena, ravi, project, ids } = await team(createUser)
  // Meena does the work unassigned and Ravi verifies it; Ravi then can't have submitted it.
  const task = await save(meena, { task_title: 'Count the cold room', project: project.row_id, verifier: ids.ravi, return_count: 9, extension_count: 4, verified_by: ids.meena })
  expect(task).toMatchObject({ return_count: 0, extension_count: 0, verified_by: null })
  const submitted = await change(meena, task, { task_state: SUBMITTED, evidence_note: 'Counted 42 crates', submitted_by: ids.ravi })
  expect(submitted.submitted_by).toBe(ids.meena)
  await expect(change(meena, submitted, { verifier: ids.meena })).rejects.toThrow('Nobody verifies a task they submitted')
  expect(await change(ravi, submitted, { task_state: 'Done' })).toMatchObject({ task_state: 'Done', verified_by: ids.ravi })
})

test('reopening a verified task clears its closure and keeps it in the history', async ({ createUser }) => {
  const { meena, ravi, task } = await assignedAndVerified(createUser)
  const submitted = await change(ravi, task, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' })
  const accepted = await change(meena, submitted, { task_state: 'Done' })
  const reopened = await change(meena, accepted, { task_state: 'In progress' })
  expect(reopened).toMatchObject({ task_state: 'In progress', verified_by: null, verified_at: null })
  const activity = await meena.get<{ versions: { data: { changed?: [string, unknown, unknown][] } }[] }>(`/api/activity/tasker.task/${task.row_id}`)
  expect(activity.versions.flatMap(version => version.data.changed ?? []).some(([field, from]) => field === 'verified_by' && from === meena.user)).toBe(true)
})

test('moving a due date once set needs a reason, and keeps the first date and the count', async ({ createUser }) => {
  const { ravi, task } = await assignedAndVerified(createUser)
  const dated = await change(ravi, task, { due_date: '2026-11-07' })
  expect(dated).toMatchObject({ extension_count: 0, original_due_date: null })
  await expect(change(ravi, dated, { due_date: '2026-11-10' })).rejects.toThrow('Give a reason for moving the due date')
  const moved = await change(ravi, dated, { due_date: '2026-11-10', change_reason: 'Electrician on leave' })
  expect(moved).toMatchObject({ extension_count: 1, extension_reason: 'Electrician on leave', change_reason: null })
  expect(String(moved.original_due_date).slice(0, 10)).toBe('2026-11-07')
  const twice = await change(ravi, moved, { due_date: '2026-11-12', change_reason: 'Starter on order' })
  expect(twice.extension_count).toBe(2)
  expect(String(twice.original_due_date).slice(0, 10)).toBe('2026-11-07')
})

test('cancelling needs a reason, which the task keeps', async ({ createUser }) => {
  const { meena, project } = await team(createUser)
  const task = await save(meena, { task_title: 'Dropped supplier visit', project: project.row_id })
  await expect(change(meena, task, { task_state: 'Cancelled' })).rejects.toThrow('Give a reason for cancelling')
  expect(await change(meena, task, { task_state: 'Cancelled', change_reason: 'Supplier closed for Diwali' }))
    .toMatchObject({ task_state: 'Cancelled', cancel_reason: 'Supplier closed for Diwali' })
})

test('a task without a verifier is marked Done as before', async ({ createUser }) => {
  const { ravi, project } = await team(createUser)
  const task = await save(ravi, { task_title: 'Check the generator', project: project.row_id })
  expect(await change(ravi, task, { is_done: true })).toMatchObject({ task_state: 'Done', is_done: true, verified_by: null })
})

/** Upload a photo the way Tasker's screens do: private, attached to the task Table. */
async function uploadPhoto(client: Client, name: string) {
  const form = new FormData()
  form.set('file', new File(['jpeg bytes'], name, { type: 'image/jpeg' }))
  form.set('is_private', '1')
  form.set('ref_table', 'tasker.task')
  const response = await client.fetch('/api/upload_file', { method: 'POST', body: form })
  return { status: response.status, body: await response.json() as Row & { file_url: string; error?: { message: string } } }
}

test('a member uploads a private photo that other members can neither read nor change', async ({ createUser }) => {
  const { meena, ravi } = await team(createUser)
  const { status, body } = await uploadPhoto(ravi, 'counter-lights.jpg')
  try {
    expect(status).toBe(201)
    expect(body).toMatchObject({ file_name: 'counter-lights.jpg', is_private: true, ref_table: 'tasker.task', file_url: expect.stringMatching(/^\/private\/files\//) })
    await expect(meena.get(`/api/table/File/${body.row_id}`)).rejects.toThrow('You don\'t have read permission on File')
    await expect(meena.get('/api/table/File')).rejects.toThrow('You don\'t have read permission on File')
    await expect(meena.get(`/api/signed_url?file_url=${encodeURIComponent(body.file_url)}`)).rejects.toThrow('You don\'t have read permission on File')
    expect((await meena.fetch(body.file_url)).status).toBe(403)
    await expect(meena.post('/api/save_row', { table: 'File', row: { row_id: body.row_id, updated_at: body.updated_at, file_name: 'renamed.jpg' } }))
      .rejects.toThrow('You don\'t have write permission on File')
    await expect(meena.delete(`/api/table/File/${body.row_id}`)).rejects.toThrow('You don\'t have delete permission on File')
  } finally {
    // Database rows roll back; uploaded disk objects do not.
    const { deleteStored } = await import('../src/storage')
    await deleteStored(body.file_url)
  }
})

test('undoing Done on a verified task starts the work over in progress', async ({ createUser }) => {
  const { meena, ravi, task } = await assignedAndVerified(createUser)
  const submitted = await change(ravi, task, { task_state: SUBMITTED, evidence_note: 'Replaced both tube lights' })
  const accepted = await change(meena, submitted, { task_state: 'Done' })
  expect(await change(meena, accepted, { is_done: false })).toMatchObject({ task_state: 'In progress', is_done: false, verified_by: null, verified_at: null })
})

test('only a Tasker member can verify a task', async ({ createUser }) => {
  const { meena, project } = await team(createUser)
  const outsider = await createUser({ roles: [] })
  await expect(save(meena, { task_title: 'Count the cold room', project: project.row_id, verifier: outsider.user }))
    .rejects.toThrow('Choose a Tasker member to verify this task')
})

test('a task without a verifier can’t be submitted for verification', async ({ createUser }) => {
  const { ravi, project } = await team(createUser)
  const task = await save(ravi, { task_title: 'Check the generator', project: project.row_id })
  await expect(change(ravi, task, { task_state: SUBMITTED, evidence_note: 'Generator runs' })).rejects.toThrow('Choose a verifier before submitting this task')
})

test('the person who submitted a task can’t make themselves its verifier and accept it', async ({ createUser }) => {
  const { meena, project, ids } = await team(createUser)
  const task = await save(meena, { task_title: 'Count the cold room', project: project.row_id, verifier: ids.ravi })
  const submitted = await change(meena, task, { task_state: SUBMITTED, evidence_note: 'Counted 42 crates' })
  await expect(change(meena, submitted, { task_state: 'Done', verifier: ids.meena })).rejects.toThrow('Nobody verifies a task they submitted')
})

test('editing a cancelled task keeps its reason', async ({ createUser }) => {
  const { meena, project } = await team(createUser)
  const task = await save(meena, { task_title: 'Dropped supplier visit', project: project.row_id })
  const cancelled = await change(meena, task, { task_state: 'Cancelled', change_reason: 'Supplier closed for Diwali' })
  expect(await change(meena, cancelled, { task_title: 'Dropped supplier visit (Diwali)' })).toMatchObject({ task_state: 'Cancelled', cancel_reason: 'Supplier closed for Diwali' })
})
