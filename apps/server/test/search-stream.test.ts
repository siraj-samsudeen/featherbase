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

// Codex review (round 3): what names nothing is decided by the Table's id rule, not the id's look.
test("a code people gave is found, even all digits; a Table of machine-made keys gives nothing", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ss Coded', id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Ss Coded', row: { row_id: '010101001', note: 'x' } })
  const coded = (await searchLines(admin, '010101001')).find((l) => l.table === 'Ss Coded') as { hits: { title: string }[] }
  expect(coded.hits.map((h) => h.title)).toEqual(['010101001'])
  await admin.post('/api/table_def', { name: 'Ss Hashed', id_pattern: 'hash', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Ss Hashed', row: { note: 'y' } })
  const hashed = (await searchLines(admin, row.row_id)).find((l) => l.table === 'Ss Hashed') as { hits: unknown[] }
  expect(hashed.hits).toEqual([])
})

test("a title that looks like an id is still a name; nameless rows never crowd out a named one", async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ss Titled', title_column: 'label', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Ss Titled', row: { label: '12345678' } })
  const titled = (await searchLines(admin, '12345678')).find((l) => l.table === 'Ss Titled') as { hits: { title: string }[] }
  expect(titled.hits.map((h) => h.title)).toEqual(['12345678'])
  // Three people with no name (named only by their opaque ids) and one with a name, all matching "zz".
  await admin.post('/api/table_def', { name: 'Ss People', id_pattern: 'prompt', title_column: 'label', columns: [{ column_name: 'label', column_type: 'Data' }] })
  for (const n of ['a', 'b', 'c']) await admin.post('/api/save_row', { table: 'Ss People', row: { row_id: `zz-${n}`, label: `psn_zz${n}aaaaaaaaaaaaaaaaa` } })
  await admin.post('/api/save_row', { table: 'Ss People', row: { row_id: 'zz-d', label: 'Named zz person' } })
  const people = (await searchLines(admin, 'zz')).find((l) => l.table === 'Ss People') as { hits: { title: string }[] }
  expect(people.hits.map((h) => h.title)).toEqual(['Named zz person'])
})

// Codex review: a search the client has abandoned launches no more Tables and ends.
test('a search whose client went away stops and yields nothing more', async ({ admin }) => {
  const { streamSearch } = await import('../src/search')
  const abort = new AbortController()
  const events = streamSearch('a', admin.user!, abort.signal)
  const first = await events.next()
  expect((first.value as { groups: unknown[] }).groups.length).toBeGreaterThan(0)
  abort.abort()
  expect(await events.next()).toEqual({ done: true, value: undefined })
})
