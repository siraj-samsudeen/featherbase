import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { deleteDoc } from '../src/document'
import { sql } from '../src/db'

// @spec runtime_row_delete_guard
test('characterization: generic runtime deletion ignores revision and leaves discussion', async ({ admin }) => {
  await discoverPackages([resolve('../..', 'runtime-apps/other')])
  await admin.post('/api/install_app', { name: 'other' })
  await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'discard', quantity: 37 } })
  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: 'other.task', ref_name: 'discard', content: 'Keep 17 comments separate from 37 units' } })
  await deleteDoc('other.task', 'discard', 'Administrator', { expectUpdatedAt: '2000-01-01' })
  expect(await sql`select row_id from other.task where row_id = 'discard'`).toHaveLength(0)
  expect(await sql`select content from comment where ref_table = 'other.task' and ref_name = 'discard'`).toEqual([{ content: 'Keep 17 comments separate from 37 units' }])
})
