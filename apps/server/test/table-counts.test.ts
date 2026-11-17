// admin-lists 11: All Tables shows each Table's rows: exact where counting is
// cheap, Postgres's estimate past EXACT_BELOW, nothing for outside sources or
// views, and only for someone who manages the instance.
import { expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, grantRole, makeTable } from './fixtures'
import { EXACT_BELOW } from '../src/table-counts'

type Counts = { counts: Record<string, { rows: number; exact: boolean }> }

test('a small Table is counted exactly; a big one reads rounded; a view has no count', async ({ admin }) => {
  const { sql } = await import('../src/db')
  await admin.post('/api/table_def', { name: 'Tc Small', columns: [{ column_name: 'note', column_type: 'Data' }] })
  for (const note of ['a', 'b', 'c']) await admin.post('/api/save_row', { table: 'Tc Small', row: { note } })
  await admin.post('/api/table_def', { name: 'Tc Big', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const big = EXACT_BELOW + 2_000
  const { tableRelation } = await import('../src/table-engine')
  const relation = await tableRelation('Tc Big')
  await sql`insert into ${sql(relation)} (row_id, note) select 'r' || g, 'x' from generate_series(1, ${big}::int) g`
  await admin.post('/api/table_def', { name: 'tc small view', kind: 'view', view_of: 'Tc Small', view_filters: [['note', '=', 'a']] })

  const { counts } = await admin.get<Counts>('/api/table_counts')
  expect(counts['Tc Small']).toEqual({ rows: 3, exact: true })
  expect(counts['Tc Big']).toEqual({ rows: big, exact: false })
  expect(counts['tc small view']).toBeUndefined()
})

test('someone who does not manage the instance gets no counts', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Tc Other', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const reader = await createUserWithRole(admin, createUser, { role: 'Tc Reader', table: 'Tc Other', can_read: true })
  expect((await reader.get<Counts>('/api/table_counts')).counts).toEqual({})
})

// Codex review: managers do not bypass creator privacy, so a count is of the rows they may read.
test("a manager who may not read others' private rows counts only their own", async ({ admin, createUser }) => {
  const table = await makeTable(admin, { name: 'Tc Private', access_policy: { version: 1, roles: ['Tc Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
  await grantRole(admin, { table: table.name, role: 'Tc Member', can_read: true, can_create: true, can_write: true })
  const owner = await createUser({ roles: ['Tc Member'] })
  const manager = await createUser({ roles: ['System Manager', 'Tc Member'] })
  await owner.post('/api/save_row', { table: table.name, row: { title: 'one' } })
  await manager.post('/api/save_row', { table: table.name, row: { title: 'mine' } })
  // Enough of the owner's private rows that a count could be tempted to estimate.
  const { sql } = await import('../src/db')
  const { tableRelation } = await import('../src/table-engine')
  const relation = await tableRelation(table.name)
  await sql`insert into ${sql(relation)} (row_id, title, created_by) select 'p' || g, 'private', ${owner.user!} from generate_series(1, ${EXACT_BELOW + 2_000}::int) g`
  await sql`analyze ${sql(relation)}`
  expect((await manager.get<Counts>('/api/table_counts')).counts[table.name]).toEqual({ rows: 1, exact: true })
})

test('a Table the manager may not read is left out, and every other Table is still counted', async ({ admin }) => {
  const shut = await makeTable(admin, { name: 'Tc Shut', access_policy: { version: 1, roles: ['Tc Shut Member'] }, columns: ['title'] })
  await admin.post('/api/table_def', { name: 'Tc Open', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Tc Open', row: { note: 'a' } })
  const { counts } = await admin.get<Counts>('/api/table_counts')
  expect(counts[shut.name]).toBeUndefined()
  expect(counts['Tc Open']).toEqual({ rows: 1, exact: true })
})
