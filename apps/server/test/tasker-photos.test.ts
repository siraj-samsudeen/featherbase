import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { installApp } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { deleteStored } from '../src/storage'
import { taskerClient } from './tasker-client'
import { expectRefused } from './fixtures'

// Tasker members hold no grant on File. A photo is attached to the task or
// issue it belongs to, so whoever may change that row may upload it, and
// whoever may open that row may open the photo.

type Row = { row_id: string; updated_at: string; [field: string]: unknown }
type Uploaded = Row & { file_url: string }

async function team(createUser: (options: { roles: string[]; fullName?: string }) => Promise<Parameters<typeof taskerClient>[0]>) {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const meena = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Meena' }))
  const ravi = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const project = await meena.post<Row>('/api/save_row', { table: 'tasker.project', row: { project_name: 'Diwali readiness' } })
  const task = await meena.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Fix the billing counter lights', project: project.row_id, assigned_to: ravi.user, verifier: meena.user } })
  return { meena, ravi, task }
}
type Client = Awaited<ReturnType<typeof team>>['meena']

const uploaded: string[] = []
/** Upload a photo the way Tasker's screens do: private, attached to its row. */
async function photo(client: Client, table: string, row: string) {
  const form = new FormData()
  form.set('file', new File(['jpeg bytes'], 'counter-lights.jpg', { type: 'image/jpeg' }))
  form.set('is_private', '1')
  form.set('ref_table', table)
  form.set('ref_name', row)
  const response = await client.fetch('/api/upload_file', { method: 'POST', body: form })
  const body = await response.json() as Uploaded
  if (body.file_url) uploaded.push(body.file_url)
  return { status: response.status, body }
}
const opens = async (client: Client, file: Uploaded) => (await client.fetch(file.file_url)).status
const signedUrl = (client: Client, file: Uploaded) => client.get<{ signed_url: string }>(`/api/signed_url?file_url=${encodeURIComponent(file.file_url)}`)

async function withCleanup(run: () => Promise<void>) {
  // Database rows roll back; uploaded disk objects do not.
  try { await run() } finally { for (const url of uploaded.splice(0)) await deleteStored(url) }
}

test('the assignee attaches an evidence photo to the task, and both they and the verifier open it', ({ createUser }) => withCleanup(async () => {
  const { meena, ravi, task } = await team(createUser)
  const { status, body } = await photo(ravi, 'tasker.task', task.row_id)
  expect(status).toBe(201)
  expect(body).toMatchObject({ is_private: true, ref_table: 'tasker.task', ref_name: task.row_id, created_by: ravi.user })
  expect(await opens(ravi, body)).toBe(200)
  expect((await signedUrl(ravi, body)).signed_url).toContain(body.file_url)
  expect(await opens(meena, body)).toBe(200)
}))

test('a member attaches a photo to the issue they raised and opens it', ({ createUser }) => withCleanup(async () => {
  const { ravi } = await team(createUser)
  const issue = await ravi.post<Row>('/api/save_row', { table: 'tasker.issue', row: { issue_title: 'Dairy chiller 2 at 9°C', category: 'Equipment failure', severity: 'High', owner_function: 'Facilities' } })
  const { status, body } = await photo(ravi, 'tasker.issue', issue.row_id)
  expect(status).toBe(201)
  expect(body).toMatchObject({ ref_table: 'tasker.issue', ref_name: issue.row_id })
  expect(await ravi.post<Row>('/api/save_row', { table: 'tasker.issue', row: { row_id: issue.row_id, updated_at: issue.updated_at, photo: body.file_url } })).toMatchObject({ photo: body.file_url })
  expect(await opens(ravi, body)).toBe(200)
  expect((await signedUrl(ravi, body)).signed_url).toContain(body.file_url)
}))

test('a photo on private work stays closed to other members and to people outside Tasker', ({ createUser }) => withCleanup(async () => {
  const { meena, ravi } = await team(createUser)
  const own = await ravi.post<Row>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Renew my bike insurance' } })
  const { status, body } = await photo(ravi, 'tasker.task', own.row_id)
  expect(status).toBe(201)
  expect(await opens(ravi, body)).toBe(200)
  expect(await opens(meena, body)).toBe(403)
  await expectRefused(signedUrl(meena, body), 403)
  const outsider = taskerClient(await createUser({ roles: [] }))
  expect(await opens(outsider, body)).toBe(403)
}))

test('opening a task’s photo gives no hold on the File rows themselves', ({ createUser }) => withCleanup(async () => {
  const { meena, ravi, task } = await team(createUser)
  const { body } = await photo(ravi, 'tasker.task', task.row_id)
  await expect(meena.get('/api/table/File')).rejects.toThrow('You don\'t have read permission on File')
  await expect(meena.post('/api/save_row', { table: 'File', row: { row_id: body.row_id, updated_at: body.updated_at, file_name: 'renamed.jpg' } }))
    .rejects.toThrow('You don\'t have write permission on File')
  await expect(meena.delete(`/api/table/File/${body.row_id}`)).rejects.toThrow('You don\'t have delete permission on File')
  expect(await opens(meena, body)).toBe(200)
}))
