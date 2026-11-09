// files-and-sharing's fenced scenarios (#1070), against the real in-process
// server. Each test is one scenario of openspec/specs/files-and-sharing/spec.md,
// step by step: someone who may change a row attaches a photo to it without
// any access to files in general; someone who may only read it is refused,
// and nothing is stored.
import { describe, expect, onTestFinished } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { deleteStored } from '../../src/storage'
import { test } from '../pg-test'
import { grantRole } from '../fixtures'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'files-and-sharing')

const TABLE = 'Attach Order'
const PHOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const orderUrl = (id: string) => `/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}`

/** The orders table with one order, and the user with exactly this access to it and nothing on File. */
async function orderFor(admin: TestClient, createUser: CreateUserFn, orderId: string, access: { can_read: true; can_write?: true }) {
  await admin.post('/api/table_def', {
    name: TABLE, id_pattern: 'prompt', title_column: 'customer',
    columns: [{ column_name: 'customer', column_type: 'Data', label: 'Customer', in_list_view: true }],
  })
  await admin.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: orderId, customer: 'Kumar Stores' })
  const role = `${TABLE} ${access.can_write ? 'read update' : 'read'}`
  await grantRole(admin, { role, table: TABLE, ...access })
  const user = await createUser({ roles: [role] })
  expect((await user.fetch('/api/table/File')).status, 'the user has no access to files in general').toBe(403)
  return user
}

async function filesOn(admin: TestClient, orderId: string) {
  const filters = encodeURIComponent(JSON.stringify([['ref_table', '=', TABLE], ['ref_name', '=', orderId]]))
  const fields = encodeURIComponent(JSON.stringify(['row_id', 'file_url', 'ref_name']))
  return (await admin.get<{ data: { file_url: string }[] }>(`/api/table/File?filters=${filters}&fields=${fields}`)).data
}

async function attachPhoto(user: TestClient, orderId: string) {
  const form = new FormData()
  form.append('ref_table', TABLE)
  form.append('ref_name', orderId)
  form.append('is_private', '1')
  form.append('file', new File([PHOTO], 'counter.png', { type: 'image/png' }))
  const res = await user.fetch('/api/upload_file', { method: 'POST', body: form })
  if (res.status === 201) {
    const { file_url } = (await res.clone().json()) as { file_url: string }
    onTestFinished(() => deleteStored(file_url).catch(() => {}))
  }
  return res
}

describe('files-and-sharing', () => {
  scenario('A photo on a row the user may change', async ({ admin, createUser }, step) => {
    let user: TestClient
    let response: Response
    await step('the user may change the order "SO-0001" but has no access to files in general', async () => {
      user = await orderFor(admin, createUser, 'SO-0001', { can_read: true, can_write: true })
    })
    await step('the user attaches a photo to the order', async () => {
      response = await attachPhoto(user, 'SO-0001')
    })
    await step('the photo is attached to the order and the user can open it', async () => {
      expect(response.status, await response.clone().text()).toBe(201)
      const files = await filesOn(admin, 'SO-0001')
      expect(files, 'one file on the order').toHaveLength(1)
      const opened = await user.fetch(files[0]!.file_url)
      expect(opened.status, `opening ${files[0]!.file_url}`).toBe(200)
      expect(Buffer.from(await opened.arrayBuffer())).toEqual(PHOTO)
    })
  })

  scenario('A row the user may only read', async ({ admin, createUser }, step) => {
    let user: TestClient
    let response: Response
    await step('the user may read the order "SO-0001" but not change it, and has no access to files in general', async () => {
      user = await orderFor(admin, createUser, 'SO-0001', { can_read: true })
      const row = (await (await user.fetch(orderUrl('SO-0001'))).json()) as { updated_at: string }
      const change = await user.fetch(orderUrl('SO-0001'), { method: 'PATCH', body: JSON.stringify({ customer: 'Changed', updated_at: row.updated_at }) })
      expect(change.status, 'the user cannot change the order').toBe(403)
    })
    await step('the user tries to attach a photo to the order', async () => {
      response = await attachPhoto(user, 'SO-0001')
    })
    await step('the upload is refused and nothing is stored', async () => {
      expect(response.status, await response.clone().text()).toBe(403)
      expect(await filesOn(admin, 'SO-0001'), 'no file on the order').toEqual([])
    })
  })
})
