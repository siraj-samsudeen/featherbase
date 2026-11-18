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

// Codex round 4: a machine-keyed row with no title of its own is no hit, and never crowds out a named one.
test('rows of machine-made keys with an empty title neither show nor crowd out a named match', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ss Hash Titled', id_pattern: 'hash', title_column: 'label', columns: [{ column_name: 'label', column_type: 'Data' }, { column_name: 'note', column_type: 'Data' }] })
  const { sql } = await import('../src/db')
  const { tableRelation } = await import('../src/table-engine')
  const relation = await tableRelation('Ss Hash Titled')
  for (const id of ['aaaa1111qq', 'aaaa2222qq', 'aaaa3333qq']) await sql`insert into ${sql(relation)} (row_id, label) values (${id}, null)`
  await sql`insert into ${sql(relation)} (row_id, label) values ('aaaa4444qq', 'Named qq row')`
  const lines = await searchLines(admin, 'qq')
  const group = lines.find((l) => l.table === 'Ss Hash Titled') as { hits: { title: string }[] }
  expect(group.hits.map((h) => h.title)).toEqual(['Named qq row'])
})

test('a client that goes away while the search waits on its Tables ends it at once', async ({ admin }) => {
  const { streamSearch } = await import('../src/search')
  const abort = new AbortController()
  const events = streamSearch('a', admin.user!, abort.signal)
  await events.next()
  // next() starts the Table searches and waits for one; the abort lands during that wait.
  const waiting = events.next()
  abort.abort()
  expect(await waiting).toEqual({ done: true, value: undefined })
})

test('a client that reads the first line and leaves stops the stream', async ({ admin }) => {
  const abort = new AbortController()
  const res = await admin.fetch('/api/search?q=a', { signal: abort.signal })
  const reader = res.body!.getReader()
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value)).toContain('"groups"')
  abort.abort()
  await reader.cancel()
  await new Promise((done) => setTimeout(done, 100))
})

// Codex round 5: a Table that fails while the caller is still reading earlier lines ends the search as failed, never done.
test('a Table that fails while earlier answers are being read ends the search with an error, never done', async ({ admin }) => {
  // Searched last (by name), after the others have answered.
  await admin.post('/api/table_def', { name: 'Zz Broken', title_column: 'note', columns: [{ column_name: 'note', column_type: 'Data' }] })
  const { sql } = await import('../src/db')
  const { tableRelation } = await import('../src/table-engine')
  await sql`alter table ${sql(await tableRelation('Zz Broken'))} rename to zz_broken_gone`
  const { streamSearch } = await import('../src/search')
  const events = streamSearch('a', admin.user!)
  await events.next() // groups
  await events.next() // a first answer; the rest, the broken one included, settle while this one is held
  await new Promise((done) => setTimeout(done, 500))
  const rest: unknown[] = []
  await expect((async () => { for await (const event of events) rest.push(event) })()).rejects.toThrow()
  expect(rest).not.toContainEqual({ done: true })
})

// Codex round 6: the test helper never passes a failed search off as an empty one.
test('searchHits rejects a search that ended in an error line', async ({ admin }) => {
  const { searchHits } = await import('./fixtures')
  const { sql } = await import('../src/db')
  await sql`drop table data_scope`
  await expect(searchHits(admin, 'anything')).rejects.toThrow('search did not finish')
})

// #1311: each Table answers its best three: a row named or coded exactly as typed, then
// one starting with it, then the shortest, so an exact match is never left out.
test('an exact match by name or by code is never crowded out by rows that only contain the text', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ss Staff', id_pattern: 'prompt', title_column: 'full_name', columns: [{ column_name: 'full_name', column_type: 'Data' }] })
  for (const [row_id, full_name] of [['S-1', 'Rekha C S'], ['S-2', 'Rekha V S'], ['S-3', 'Rekha C'], ['S-4', 'Surekha M'], ['S-5', 'Rekha']])
    await admin.post('/api/save_row', { table: 'Ss Staff', row: { row_id, full_name } })
  const staff = (await searchLines(admin, 'rekha')).find((l) => l.table === 'Ss Staff') as { hits: { title: string }[] }
  expect(staff.hits.map((h) => h.title)).toEqual(['Rekha', 'Rekha C', 'Rekha C S'])

  await admin.post('/api/table_def', { name: 'Ss Site', id_pattern: 'prompt', title_column: 'site_name', columns: [{ column_name: 'site_name', column_type: 'Data' }] })
  for (const [row_id, site_name] of [['ATK-CAR-PARK', 'Car park'], ['ATK-HOSTEL', 'Hostel'], ['ATK-STORE', 'Store building'], ['ATK', 'Attakulangara']])
    await admin.post('/api/save_row', { table: 'Ss Site', row: { row_id, site_name } })
  const sites = (await searchLines(admin, 'ATK')).find((l) => l.table === 'Ss Site') as { hits: { row_id: string }[] }
  expect(sites.hits[0].row_id).toBe('ATK')
})
