import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { deleteDoc } from '../src/document'
import { sql } from '../src/db'

// @spec runtime_row_delete_guard
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
