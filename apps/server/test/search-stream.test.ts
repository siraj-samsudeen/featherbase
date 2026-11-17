// #1265: the search answers group by group: first the groups it will search
// (each by its Table's label, in the order they show), then one line per
// group as its Table answers, then done. No hit is named by an opaque id.
import { expect } from 'vitest'
import { test } from './pg-test'
import { searchLines } from './fixtures'

test('the groups come first, each by label; every group answers once; done comes last', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ss Store', title_column: 'store_name', columns: [{ column_name: 'store_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Ss Store', row: { store_name: 'Mohammad Stores' } })
  const lines = await searchLines(admin, 'mohammad')
  const groups = (lines[0] as { groups: { table: string; label: string }[] }).groups
  expect(groups.length).toBeGreaterThan(1)
  expect(groups).toContainEqual({ table: 'Ss Store', label: 'Ss Store' })
  const answers = lines.slice(1, -1) as { table: string; hits: { title: string }[] }[]
  expect(answers.map((a) => a.table).sort()).toEqual(groups.map((g) => g.table).sort())
  expect(answers.find((a) => a.table === 'Ss Store')!.hits.map((h) => h.title)).toEqual(['Mohammad Stores'])
  expect(lines.at(-1)).toEqual({ done: true })
})

test('a row whose only name is an opaque id is no result', async ({ admin }) => {
  // A Table with no title column names its rows by their key.
  await admin.post('/api/table_def', { name: 'Ss Keyed', id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Ss Keyed', row: { row_id: 'psn_aaaaaaaaaaaaaaaaaaaa', note: 'x' } })
  await admin.post('/api/save_row', { table: 'Ss Keyed', row: { row_id: 'psn-readable-code', note: 'y' } })
  const keyed = (await searchLines(admin, 'psn')).find((l) => l.table === 'Ss Keyed') as { hits: { title: string }[] }
  expect(keyed.hits.map((h) => h.title)).toEqual(['psn-readable-code'])
})
