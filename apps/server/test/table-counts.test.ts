// admin-lists 11: All Tables shows each Table's rows: exact where counting is
// cheap, Postgres's estimate past EXACT_BELOW, nothing for outside sources or
// views, and only for someone who manages the instance.
import { expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole } from './fixtures'
import { EXACT_BELOW } from '../src/table-counts'

type Counts = { counts: Record<string, { rows: number; exact: boolean }> }

test('a small Table is counted exactly; a big one by its estimate; a view has no count', async ({ admin }) => {
  const { sql } = await import('../src/db')
  await admin.post('/api/table_def', { name: 'Tc Small', columns: [{ column_name: 'note', column_type: 'Data' }] })
  for (const note of ['a', 'b', 'c']) await admin.post('/api/save_row', { table: 'Tc Small', row: { note } })
  await admin.post('/api/table_def', { name: 'Tc Big', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const big = EXACT_BELOW + 2_000
  const { tableRelation } = await import('../src/table-engine')
  const relation = await tableRelation('Tc Big')
  await sql`insert into ${sql(relation)} (row_id, note) select 'r' || g, 'x' from generate_series(1, ${big}::int) g`
  await sql`analyze ${sql(relation)}`
  await admin.post('/api/table_def', { name: 'tc small view', kind: 'view', view_of: 'Tc Small', view_filters: [['note', '=', 'a']] })

  const { counts } = await admin.get<Counts>('/api/table_counts')
  expect(counts['Tc Small']).toEqual({ rows: 3, exact: true })
  expect(counts['Tc Big'].exact).toBe(false)
  expect(Math.abs(counts['Tc Big'].rows - big)).toBeLessThan(big * 0.1)
  expect(counts['tc small view']).toBeUndefined()
})

test('someone who does not manage the instance gets no counts', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Tc Other', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const reader = await createUserWithRole(admin, createUser, { role: 'Tc Reader', table: 'Tc Other', can_read: true })
  expect((await reader.get<Counts>('/api/table_counts')).counts).toEqual({})
})
