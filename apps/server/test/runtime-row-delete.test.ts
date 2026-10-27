import { resolve } from 'node:path'
import { expect } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { test as base } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { deleteDoc } from '../src/document'
import { sql } from '../src/db'

const test = base.extend<{ admin: TestClient }>({
  admin: async ({ admin }, use) => use(makeClient({ request: (path, init) => admin.fetch(String(path), {
    ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'actionproof@1.1.0' },
  }) }, admin.token, admin.user)),
})

test('generic runtime deletion cannot bypass source revision or retained discussion', async ({ admin }) => {
  await discoverPackages([resolve('../..', 'runtime-apps/other')])
  await admin.post('/api/install_app', { name: 'other' })
  const source = await admin.post<any>('/api/save_row', { table: 'other.task', row: { row_id: 'discard', quantity: 37 } })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'other.task', ref_name: 'discard', content: 'Keep 17 comments separate from 37 units' } })
  await expect(deleteDoc('other.task', 'discard', 'Administrator', { expectUpdatedAt: '2000-01-01' })).rejects.toMatchObject({ type: 'ConflictError' })
  await expect(deleteDoc('other.task', 'discard', 'Administrator', { expectUpdatedAt: source.updated_at })).rejects.toMatchObject({ type: 'ValidationError', fields: { comments: '1', versions: '0', references: '0' } })
  expect(await sql`select row_id from other.task where row_id = 'discard'`).toHaveLength(1)
  expect(await sql`select content from comment where ref_table = 'other.task' and ref_name = 'discard'`).toEqual([{ content: 'Keep 17 comments separate from 37 units' }])
})

test('Admin attachments and shares retain exact targets through raw/action deletion and restart', async ({ admin }) => {
  const directory = resolve('../..', 'runtime-apps/action-proof')
  await discoverPackages([directory])
  await admin.post('/api/install_app', { name: 'actionproof' })
  const save = (table: string, row: Record<string, unknown>) => admin.post<any>('/api/save_row', { table, row })
  const source = await save('actionproof.work', { row_id: 'linked', title: 'Retain 37 units' })
  const bare = await save('actionproof.work', { row_id: 'bare', title: 'Discard 19 units' })
  await admin.post('/api/table/actionproof.destination', { row_id: 'bare', title: 'Different target table' })
  const files = []
  for (const file_name of ['invoice-17.txt', 'photo-43.png'])
    files.push(await save('File', { file_name, ref_table: 'actionproof.work', ref_name: 'linked' }))
  const share = await save('Share', { share_table: 'actionproof.work', share_name: 'linked', person: 'Administrator', read: true })
  await save('File', { file_name: 'unattached.txt' })
  await save('File', { file_name: 'table.txt', ref_table: 'actionproof.work' })
  await save('File', { file_name: 'other.txt', ref_table: 'actionproof.destination', ref_name: 'bare' })
  await save('Share', { share_table: 'actionproof.destination', share_name: 'bare', person: 'Administrator' })
  const request = { idempotencyKey: 'links', payload: { source: 'linked', updatedAt: source.updated_at, explain: true } }
  const path = '/api/app_actions/actionproof/discard'
  const result = await admin.post(path, request)
  expect(result).toEqual({ result: { deleted: false, counts: { comments: 0, versions: 0, references: 0, files: 2, shares: 1 } } })
  const raw = await admin.fetch(`/api/table/actionproof.work/linked?updated_at=${encodeURIComponent(source.updated_at)}`, { method: 'DELETE' })
  expect(raw.status).toBe(417)
  expect(await raw.json()).toMatchObject({ error: { fields: { files: '2', shares: '1' } } })
  const refusedRequest = JSON.stringify({ idempotencyKey: 'delete-links', payload: { ...request.payload, explain: false } })
  const refused = await admin.fetch(path, { method: 'POST', body: refusedRequest })
  expect(refused.status).toBe(417)
  const refusal = await refused.json()
  expect(refusal).toMatchObject({ error: { fields: { files: '2', shares: '1' } } })
  expect(await sql`select * from runtime_action_result where idempotency_key = 'delete-links'`).toHaveLength(0)
  await discoverPackages([directory])
  await loadInstalledApps()
  expect(await admin.post(path, request)).toEqual(result)
  // The refused delete itself, submitted again after the restart, gives the same reason and deletes nothing.
  const replayed = await admin.fetch(path, { method: 'POST', body: refusedRequest })
  expect(replayed.status).toBe(417)
  expect(await replayed.json()).toEqual(refusal)
  expect(await sql`select row_id from actionproof.work where row_id = 'linked'`).toHaveLength(1)
  expect(await sql`select row_id from file where ref_table = 'actionproof.work' and ref_name = 'linked'`).toHaveLength(2)
  expect(await sql`select row_id from share where row_id = ${share.row_id}`).toHaveLength(1)
  // Exact (table,row) matching, not just ref_name, and no table-wide retention.
  await admin.delete(`/api/table/actionproof.work/bare?updated_at=${encodeURIComponent(bare.updated_at)}`)
  for (const [table, row, field] of [['File', files[0], 'ref_name'], ['Share', share, 'share_name']] as const) {
    await expect(save(table, { ...row, [field]: 'bare' })).rejects.toMatchObject({ status: 404 })
  }
  expect(await sql`select ref_name from file where row_id = ${files[0].row_id}`).toEqual([{ ref_name: 'linked' }])
  expect(await sql`select share_name from share where row_id = ${share.row_id}`).toEqual([{ share_name: 'linked' }])
  await admin.post('/api/set_app_enabled', { name: 'actionproof', enabled: false })
  await expect(save('File', { file_name: 'disabled', ref_table: 'actionproof.work', ref_name: 'linked' })).rejects.toMatchObject({ status: 403 })
  await expect(save('Share', { share_table: 'actionproof.work', share_name: 'linked', person: 'Administrator' })).rejects.toMatchObject({ status: 403 })
})

test('a row another Table refers to is retained, and a reference from a Settings Table refuses the delete it cannot prove', async ({ admin }) => {
  await discoverPackages([resolve('../..', 'runtime-apps/other')])
  await admin.post('/api/install_app', { name: 'other' })
  const source = await admin.post<any>('/api/save_row', { table: 'other.task', row: { row_id: 'kept', quantity: 23 } })
  await admin.post('/api/table_def', { name: 'Rrd Pointer', columns: [{ column_name: 'task', column_type: 'Reference', reference_table: 'other.task' }] })
  await admin.post('/api/save_row', { table: 'Rrd Pointer', row: { task: 'kept' } })
  await expect(deleteDoc('other.task', 'kept', 'Administrator', { expectUpdatedAt: source.updated_at }))
    .rejects.toMatchObject({ type: 'ValidationError', fields: { references: '1' } })

  await admin.post('/api/table_def', { name: 'Rrd Settings', kind: 'settings', columns: [{ column_name: 'default_task', column_type: 'Reference', reference_table: 'other.task' }] })
  await expect(deleteDoc('other.task', 'kept', 'Administrator', { expectUpdatedAt: source.updated_at }))
    .rejects.toMatchObject({ type: 'ValidationError', message: 'Deletion cannot prove references from nonlocal Tables' })
  expect(await sql`select row_id from other.task where row_id = 'kept'`).toHaveLength(1)
})
