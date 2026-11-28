// #1459: every Table declares who reads which of its rows, one rule from a closed set; a Table with none is read by
// System Managers only. These pin the rule on each read path (list, count, chart, search, single row, write, related
// filter, Sub-table rows, Comments and Versions, row titles, realtime, MCP, View As, a connected Table), for a
// System Manager's own Tables and an app's. A Table about places is in scoped-tables.test.ts. Every row is made up.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterAll, afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectRefused, grantRole, makeTable, searchHits, tableRef } from './fixtures'
import { connectAgent, issueToken } from './agent-driver'
import { dropExploreSource, EXPLORE_STORE, exploreSource } from './explore-source'
import { discoverPackages } from '../src/runtime-packages'
import { eventVisibleTo } from '../src/realtime'
import { getList } from '../src/query'
import { getDoc, saveDoc } from '../src/document'
import { runViewingAs } from '../src/view-as-context'
import { sql } from '../src/db'

const PROJECT = tableRef('Rr Project')
const TASK = tableRef('Rr Task')
const STEP = tableRef('Rr Step')
const ROLE = 'Rr Reader'
const EVERYTHING = { can_read: true, can_write: true, can_create: true, can_delete: true }

type Rule = Record<string, unknown> | null
interface World { reader: TestClient; other: TestClient }

/** Projects p1 (the reader's), p2 (the other person's) and p3 (the administrator's, naming the reader as owner);
 *  tasks t1 on p1, t2 on p2 (each with one step) and t3 on no project. The reader's role may do everything on all. */
async function world(admin: TestClient, createUser: CreateUserFn, project: Rule, task: Rule = { kind: 'all' }): Promise<World> {
  await makeTable(admin, { name: PROJECT.name, id_pattern: 'prompt', title_column: 'title', track_changes: true, row_rule: null,
    columns: ['title', 'stage', { column_name: 'owner', column_type: 'Reference', reference_table: 'Person' }] })
  await makeTable(admin, { name: STEP.name, kind: 'sub_table', columns: ['what'] })
  await makeTable(admin, { name: TASK.name, id_pattern: 'prompt', title_column: 'title', row_rule: null,
    columns: ['title', { column_name: 'project', column_type: 'Reference', reference_table: PROJECT.name },
      { column_name: 'steps', column_type: 'Sub-table', row_table: STEP.name }] })
  const reader = await createUserWithRole(admin, createUser, { role: ROLE, table: [PROJECT.name, TASK.name, STEP.name], ...EVERYTHING })
  const other = await createUser({ roles: [ROLE] })
  // rows are written while the Tables read whole, then the rules under test are set
  for (const table of [PROJECT, TASK]) await admin.put(`${table.defUrl}/row_rule`, { row_rule: { kind: 'all' } })
  await reader.post(PROJECT.url, { row_id: 'p1', title: 'North fit-out', stage: 'open' })
  await other.post(PROJECT.url, { row_id: 'p2', title: 'South fit-out', stage: 'open' })
  await admin.post(PROJECT.url, { row_id: 'p3', title: 'Depot fit-out', stage: 'done', owner: reader.user })
  await admin.post(TASK.url, { row_id: 't1', title: 'North shelving', project: 'p1', steps: [{ what: 'measure north' }] })
  await admin.post(TASK.url, { row_id: 't2', title: 'South shelving', project: 'p2', steps: [{ what: 'measure south' }] })
  await admin.post(TASK.url, { row_id: 't3', title: 'Loose shelving' })
  await admin.put(`${PROJECT.defUrl}/row_rule`, { row_rule: project })
  await admin.put(`${TASK.defUrl}/row_rule`, { row_rule: task })
  return { reader, other }
}

const ids = async (client: TestClient, table = PROJECT, filters: unknown[] = []) =>
  (await client.get<{ data: { row_id: string }[] }>(table.listUrl({ filters, limit_page_length: 500 }))).data.map((row) => row.row_id).sort()
const count = async (client: TestClient, table: string) => (await client.post<{ count: number }>('/api/dashboard/count', { table })).count
/** A change as `client` makes it, at the row's current version (read by the administrator). */
const patch = async (admin: TestClient, client: TestClient, table: typeof PROJECT, id: string, values: Record<string, unknown>) =>
  client.fetch(table.rowUrl(id), { method: 'PATCH', body: JSON.stringify({ updated_at: (await admin.get<{ updated_at: string }>(table.rowUrl(id))).updated_at, ...values }) })
const event = (table: string, row_id: string, kind = 'updated') => ({ channel: `row:${table}:${row_id}`, event: kind, payload: { table, row_id } }) as never

describe('#1459 a Table with no row rule is read by System Managers only', () => {
  test('a new Table has no rule, and a grant alone reads none of its rows on any path', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, null)
    expect(await ids(reader)).toEqual([])
    expect((await reader.get<{ total: number }>(PROJECT.url)).total).toBe(0)
    expect(await count(reader, PROJECT.name)).toBe(0)
    expect((await reader.post<{ data: unknown[] }>('/api/dashboard/chart', { table: PROJECT.name, group_by: 'stage' })).data).toEqual([])
    expect((await searchHits(reader, 'fit-out')).filter((hit) => hit.table === PROJECT.name)).toEqual([])
    expect((await reader.post<{ titles: unknown[] }>('/api/row_titles', [{ table: PROJECT.name, row_id: 'p1' }]).catch(() => ({ titles: [] }))).titles).toEqual([])
    // even the row the reader wrote: nothing says whose rows these are
    await expectRefused(reader.get(PROJECT.rowUrl('p1')), 403, 'has no row rule yet')
    await expectRefused(await patch(admin, reader, PROJECT, 'p1', { stage: 'done' }), 403)
    await expectRefused(reader.post(PROJECT.url, { row_id: 'p9', title: 'New' }), 403)
    await expectRefused(reader.delete(PROJECT.rowUrl('p1')), 403)
    expect(await eventVisibleTo(reader.user!, event(PROJECT.name, 'p1'))).toBe(false)
    expect(await ids(admin)).toEqual(['p1', 'p2', 'p3'])
  })

  test('the rule is asked for when the Table is made, and stays closed when it is left out', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Rr Bare', columns: [{ column_name: 'title', column_type: 'Data' }] })
    const [bare] = await sql`select row_rule from featherbase.table_def where name = 'Rr Bare'`
    expect(bare.row_rule).toBeNull()
    await admin.post('/api/table_def', { name: 'Rr Said', row_rule: { kind: 'own' }, columns: [{ column_name: 'title', column_type: 'Data' }] })
    const [said] = await sql`select row_rule from featherbase.table_def where name = 'Rr Said'`
    expect(said.row_rule).toEqual({ kind: 'own' })
  })

  test('"administrators" says the same out loud', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'administrators' })
    expect(await ids(reader)).toEqual([])
    await expectRefused(reader.get(PROJECT.rowUrl('p1')), 403, 'Only a System Manager reads')
    expect(await ids(admin)).toEqual(['p1', 'p2', 'p3'])
  })

  test('an agent over MCP reads what its person reads', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, null)
    const agent = await connectAgent(await issueToken(reader))
    expect((await agent.ok<{ total: number }>('query_rows', { table: PROJECT.name })).total).toBe(0)
    await admin.put(`${PROJECT.defUrl}/row_rule`, { row_rule: { kind: 'own' } })
    expect((await agent.ok<{ rows: { row_id: string }[] }>('query_rows', { table: PROJECT.name })).rows.map((row) => row.row_id)).toEqual(['p1'])
  })
})

describe('#1459 "all": every row, to whoever a grant reaches', () => {
  test('the reader lists, counts and opens every row; someone with no grant still reads none', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'all' })
    expect(await ids(reader)).toEqual(['p1', 'p2', 'p3'])
    expect(await count(reader, PROJECT.name)).toBe(3)
    expect(await eventVisibleTo(reader.user!, event(PROJECT.name, 'p2'))).toBe(true)
    const stranger = await createUser()
    await expectRefused(stranger.get(PROJECT.url), 403)
  })
})

describe('#1459 "own": the rows a person created, or that name them', () => {
  test('lists, counts, charts, search and row titles hold their own rows only', async ({ admin, createUser }) => {
    const { reader, other } = await world(admin, createUser, { kind: 'own' })
    expect(await ids(reader)).toEqual(['p1'])
    expect(await ids(other)).toEqual(['p2'])
    expect(await count(reader, PROJECT.name)).toBe(1)
    expect((await reader.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', { table: PROJECT.name, group_by: 'stage' })).data).toEqual([{ label: 'open', value: 1 }])
    expect((await searchHits(reader, 'fit-out')).filter((hit) => hit.table === PROJECT.name).map((hit) => hit.row_id)).toEqual(['p1'])
    await expectRefused(reader.get(PROJECT.rowUrl('p2')), 403, 'not one of your rows')
    await expectRefused(reader.delete(PROJECT.rowUrl('p2')), 403)
    expect(await eventVisibleTo(reader.user!, event(PROJECT.name, 'p1'))).toBe(true)
    expect(await eventVisibleTo(reader.user!, event(PROJECT.name, 'p2'))).toBe(false)
    expect(await eventVisibleTo(reader.user!, event(PROJECT.name, 'p1', 'deleted'))).toBe(false)
  })

  test('a Person column the rule names makes the row theirs too', async ({ admin, createUser }) => {
    const { reader, other } = await world(admin, createUser, { kind: 'own', columns: ['owner'] })
    expect(await ids(reader)).toEqual(['p1', 'p3'])
    expect(await ids(other)).toEqual(['p2'])
    expect((await reader.get<{ row_id: string }>(PROJECT.rowUrl('p3'))).row_id).toBe('p3')
  })

  test('a role the rule reads every row for is not narrowed', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'own', whole_for: ['Rr Head Office'] })
    await grantRole(admin, { role: 'Rr Head Office', table: [] })
    const head = await createUser({ roles: [ROLE, 'Rr Head Office'] })
    expect(await ids(head)).toEqual(['p1', 'p2', 'p3'])
    expect(await ids(reader)).toEqual(['p1'])
    // the role alone reaches nothing: a grant still decides who reads the Table
    await expectRefused((await createUser({ roles: ['Rr Head Office'] })).get(PROJECT.url), 403)
  })

  test('while viewing as someone, the reads are theirs', async ({ admin, createUser }) => {
    const { reader, other } = await world(admin, createUser, { kind: 'own' })
    const seen = await runViewingAs({ tester: other.user!, person: reader.user!, name: 'the reader' }, () => getList(PROJECT.name, {}, reader.user!))
    expect((seen.data as { row_id: string }[]).map((row) => row.row_id)).toEqual(['p1'])
  })
})

describe('#1459 "through": the rows whose reference names a row the person can read', () => {
  const THROUGH = { kind: 'through', column: 'project' }

  test('a task is read with its project, and one on no project by no one', async ({ admin, createUser }) => {
    const { reader, other } = await world(admin, createUser, { kind: 'own' }, THROUGH)
    expect(await ids(reader, TASK)).toEqual(['t1'])
    expect(await ids(other, TASK)).toEqual(['t2'])
    expect(await count(reader, TASK.name)).toBe(1)
    await expectRefused(reader.get(TASK.rowUrl('t2')), 403, 'belongs to a Rr Project row you cannot read')
    await expectRefused(reader.get(TASK.rowUrl('t3')), 403)
    expect(await ids(admin, TASK)).toEqual(['t1', 't2', 't3'])
  })

  test('a task cannot be written onto a project the person cannot read', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'own' }, THROUGH)
    await expectRefused(reader.post(TASK.url, { row_id: 't8', title: 'Sneaked', project: 'p2' }), 403)
    await expectRefused(await patch(admin, reader, TASK, 't1', { project: 'p2' }), 403)
    await reader.post(TASK.url, { row_id: 't9', title: 'North lighting', project: 'p1' })
    expect(await ids(reader, TASK)).toEqual(['t1', 't9'])
  })

  test('a related filter, Sub-table rows, Comments and Versions follow the rule', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'own' }, THROUGH)
    // projects holding a task: only through tasks and projects the reader reads
    expect(await ids(reader, PROJECT, [['row_id', 'related', { table: TASK.name, column: 'project' }]])).toEqual(['p1'])
    expect(await ids(reader, TASK, [['project', 'related', { table: PROJECT.name, filters: [['stage', '=', 'open']] }]])).toEqual(['t1'])
    const steps = (await reader.get<{ data: { what: string }[] }>(STEP.listUrl({ fields: ['what'] }))).data.map((row) => row.what)
    expect(steps).toEqual(['measure north'])
    for (const [table, name] of [[PROJECT.name, 'p1'], [PROJECT.name, 'p2'], [TASK.name, 't2']])
      await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: table, ref_name: name, content: `about ${name}` } })
    for (const table of ['Comment', 'Version'])
      await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: table, role: ROLE, operation: 'read', scope_mode: 'all', column_rule: 'every' } })
    const attached = async (table: string) => (await reader.get<{ data: { ref_name: string }[] }>(
      `/api/table/${table}?${new URLSearchParams({ fields: JSON.stringify(['ref_name']), limit_page_length: '500' })}`)).data.map((row) => row.ref_name).sort()
    expect(await attached('Comment')).toEqual(['p1'])
    await patch(admin, admin, PROJECT, 'p2', { stage: 'done' })
    await patch(admin, admin, PROJECT, 'p1', { stage: 'done' })
    expect([...new Set(await attached('Version'))]).toEqual(['p1'])
  })

  test('a ring of rules ends closed', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'own' }, THROUGH)
    await admin.put(PROJECT.defUrl, { name: PROJECT.name, columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'stage', column_type: 'Data' },
      { column_name: 'owner', column_type: 'Reference', reference_table: 'Person' }, { column_name: 'lead_task', column_type: 'Reference', reference_table: TASK.name }] })
    await admin.put(`${PROJECT.defUrl}/row_rule`, { row_rule: { kind: 'through', column: 'lead_task' } })
    await patch(admin, admin, PROJECT, 'p1', { lead_task: 't1' })
    expect(await ids(reader)).toEqual([])
    expect(await ids(reader, TASK)).toEqual([])
    await expectRefused(reader.get(TASK.rowUrl('t1')), 403)
  })
})

describe('#1459 a System Manager sets a Table\'s rule', () => {
  test('only a System Manager, and only a rule the Table can carry', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'all' })
    await expectRefused(reader.put(`${PROJECT.defUrl}/row_rule`, { row_rule: { kind: 'all' } }), 403)
    await expectRefused(reader.get('/api/row_rules'), 403)
    const refused = (row_rule: unknown, table = PROJECT) => expectRefused(admin.put(`${table.defUrl}/row_rule`, { row_rule }), 417)
    await refused({ kind: 'everybody' })
    await refused({ kind: 'own', columns: ['title'] })
    await refused({ kind: 'through', column: 'owner_missing' })
    await refused({ kind: 'places', columns: { store: 'missing' } })
    await refused({ kind: 'all' }, STEP)
    await makeTable(admin, { name: 'Rr Settings', kind: 'settings', columns: ['note'] })
    await refused({ kind: 'own' }, tableRef('Rr Settings'))
  })

  test('renaming a column the rule names renames it in the rule, and it cannot be removed', async ({ admin, createUser }) => {
    await world(admin, createUser, { kind: 'own', columns: ['owner'] })
    await admin.post(`${PROJECT.defUrl}/rename_column`, { from: 'owner', to: 'keeper' })
    const [renamed] = await sql`select row_rule from featherbase.table_def where name = ${PROJECT.name}`
    expect(renamed.row_rule).toEqual({ kind: 'own', columns: ['keeper'] })
    await expectRefused(admin.put(PROJECT.defUrl, { name: PROJECT.name, columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'stage', column_type: 'Data' }], remove_columns: ['keeper'] }), 417)
    // an update that leaves the rule out keeps it
    await admin.put(PROJECT.defUrl, { name: PROJECT.name, description: 'kept', columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'stage', column_type: 'Data' },
      { column_name: 'keeper', column_type: 'Reference', reference_table: 'Person' }] })
    const [kept] = await sql`select row_rule from featherbase.table_def where name = ${PROJECT.name}`
    expect(kept.row_rule).toEqual({ kind: 'own', columns: ['keeper'] })
  })

  test('the report lists every Table\'s rule, those with none, and those everyone reads whole', async ({ admin, createUser }) => {
    await world(admin, createUser, { kind: 'own' }, null)
    await makeTable(admin, { name: 'Rr Open', columns: ['title'] })
    await grantRole(admin, { role: 'All', table: 'Rr Open', can_read: true })
    const lines = (await admin.get<{ data: { table: string; app: string | null; rule: unknown; from: string; readers: string[]; everyone_reads_whole: boolean }[] }>('/api/row_rules')).data
    const line = (table: string) => lines.find((l) => l.table === table)
    expect(line(PROJECT.name)).toMatchObject({ rule: { kind: 'own' }, from: 'instance', readers: [ROLE], everyone_reads_whole: false })
    expect(line(TASK.name)).toMatchObject({ rule: null, from: 'none' })
    expect(line('Rr Open')).toMatchObject({ rule: { kind: 'all' }, everyone_reads_whole: true })
    expect(line(STEP.name)).toBeUndefined()
    // the platform's own Tables each have a rule
    expect(lines.filter((l) => !l.table.startsWith('Rr ') && l.app === null && l.rule === null)).toEqual([])
  })
})

describe('#1459 a Settings Table\'s one row follows its rule too', () => {
  const SETTINGS = tableRef('Rr Defaults')

  test('read and saved by whoever is granted with "all"; by no one but a System Manager without a rule', async ({ admin, createUser }) => {
    await makeTable(admin, { name: SETTINGS.name, kind: 'settings', columns: ['greeting'] })
    const reader = await createUserWithRole(admin, createUser, { role: ROLE, table: SETTINGS.name, can_read: true, can_write: true })
    await saveDoc(SETTINGS.name, { greeting: 'hello' }, 'Administrator')
    expect(await getDoc(SETTINGS.name, SETTINGS.name, reader.user!)).toMatchObject({ greeting: 'hello' })
    await saveDoc(SETTINGS.name, { greeting: 'hi' }, reader.user!)
    for (const rule of [null, { kind: 'administrators' }]) {
      await admin.put(`${SETTINGS.defUrl}/row_rule`, { row_rule: rule })
      await expect(getDoc(SETTINGS.name, SETTINGS.name, reader.user!)).rejects.toMatchObject({ type: 'PermissionError' })
      await expect(saveDoc(SETTINGS.name, { greeting: 'mine now' }, reader.user!)).rejects.toMatchObject({ type: 'PermissionError' })
      await expectRefused(reader.get(SETTINGS.rowUrl(SETTINGS.name)), 403)
    }
    expect(await getDoc(SETTINGS.name, SETTINGS.name, 'Administrator')).toMatchObject({ greeting: 'hi' })
  })
})

describe('#1459 a refusal and the record of a rule', () => {
  test('a refusal never names the row it keeps back', async ({ admin, createUser }) => {
    const { reader } = await world(admin, createUser, { kind: 'own' })
    const refused = await expectRefused(reader.get(PROJECT.rowUrl('p2')), 403)
    expect(refused.message).not.toContain('p2')
  })

  test('a rule said when a Table is made or changed is in the Access Log, as one set on its own is', async ({ admin }) => {
    const logged = async () => (await sql`select scope from featherbase.access_log where operation = 'set_row_rule' and ref_table = 'Rr Logged' order by created_at`).map((row) => row.scope)
    await admin.post('/api/table_def', { name: 'Rr Logged', row_rule: { kind: 'own' }, columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.put('/api/table_def/Rr%20Logged', { name: 'Rr Logged', row_rule: { kind: 'all' }, columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.put('/api/table_def/Rr%20Logged/row_rule', { row_rule: null })
    expect(await logged()).toEqual(['{"kind":"own"}', '{"kind":"all"}', 'cleared'])
  })

  test('the report counts a narrowed Table everyone reads whole through a role everyone holds', async ({ admin }) => {
    await makeTable(admin, { name: 'Rr Wide', columns: ['title'], row_rule: { kind: 'own', whole_for: ['All'] } })
    await makeTable(admin, { name: 'Rr Narrow', columns: ['title'], row_rule: { kind: 'own' } })
    await grantRole(admin, { role: 'All', table: ['Rr Wide', 'Rr Narrow'], can_read: true })
    const lines = (await admin.get<{ data: { table: string; everyone_reads_whole: boolean }[] }>('/api/row_rules')).data
    expect(lines.find((l) => l.table === 'Rr Wide')?.everyone_reads_whole).toBe(true)
    expect(lines.find((l) => l.table === 'Rr Narrow')?.everyone_reads_whole).toBe(false)
  })
})

describe('#1459 an app declares its Tables\' rules', () => {
  const APP = 'ruleproof'
  const NOTE = tableRef(`${APP}.note`)
  const LOG = tableRef(`${APP}.log`)
  const manifest = (rowRules: Record<string, unknown> | undefined) => ({
    manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Row rule proof', entryTable: NOTE.name,
    tables: [
      { name: NOTE.name, label: 'note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] },
      { name: LOG.name, label: 'log', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] },
    ],
    roles: ['Note Reader'],
    permissions: [{ table: NOTE.name, role: 'Note Reader', can_read: true, can_create: true }, { table: LOG.name, role: 'Note Reader', can_read: true }],
    ...(rowRules ? { rowRules } : {}),
  })
  const folders: string[] = []
  afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
  async function install(admin: TestClient, rowRules: Record<string, unknown> | undefined) {
    const dir = await mkdtemp(resolve('test/.row-rule-proof-'))
    folders.push(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
    await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest(rowRules)))
    const problems = await discoverPackages([dir])
    if (problems.length) return problems
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/save_row', { table: NOTE.name, row: { row_id: 'n1', body: 'the administrator\'s' } })
    await admin.post('/api/save_row', { table: LOG.name, row: { row_id: 'l1', body: 'a line' } })
    return []
  }

  test('a Table the app gives a rule is read by it; one it leaves out is closed', async ({ admin, createUser }) => {
    expect(await install(admin, { [NOTE.name]: { kind: 'own' } })).toEqual([])
    const reader = await createUser({ roles: ['Note Reader'] })
    await reader.post(NOTE.url, { row_id: 'n2', body: 'the reader\'s' })
    expect(await ids(reader, NOTE)).toEqual(['n2'])
    expect(await ids(reader, LOG)).toEqual([])
    await expectRefused(reader.get(LOG.rowUrl('l1')), 403)
    expect(await ids(admin, LOG)).toEqual(['l1'])
  })

  test('the instance\'s own rule wins over the app\'s, and taking it away returns to the app\'s', async ({ admin, createUser }) => {
    expect(await install(admin, { [NOTE.name]: { kind: 'own' }, [LOG.name]: { kind: 'all' } })).toEqual([])
    const reader = await createUser({ roles: ['Note Reader'] })
    expect(await ids(reader, LOG)).toEqual(['l1'])
    await admin.put(`${LOG.defUrl}/row_rule`, { row_rule: { kind: 'administrators' } })
    expect(await ids(reader, LOG)).toEqual([])
    await admin.put(`${NOTE.defUrl}/row_rule`, { row_rule: { kind: 'all' } })
    expect(await ids(reader, NOTE)).toEqual(['n1'])
    await admin.put(`${LOG.defUrl}/row_rule`, { row_rule: null })
    expect(await ids(reader, LOG)).toEqual(['l1'])
    const lines = (await admin.get<{ data: { table: string; from: string }[] }>('/api/row_rules')).data
    expect(lines.find((l) => l.table === NOTE.name)?.from).toBe('instance')
    expect(lines.find((l) => l.table === LOG.name)?.from).toBe('app')
  })

  test('the declaration names the app\'s own Tables and columns the rule can use', async ({ admin }) => {
    const problems = async (rowRules: Record<string, unknown>) => JSON.stringify(await install(admin, rowRules))
    expect(await problems({ 'Rr Elsewhere': { kind: 'all' } })).toContain('not one of the app')
    expect(await problems({ [NOTE.name]: { kind: 'own', columns: ['body'] } })).toContain('not a Reference to Person')
    expect(await problems({ [NOTE.name]: { kind: 'through', column: 'body' } })).toContain('not a Reference to one Table')
    expect(await problems({ [NOTE.name]: { kind: 'somehow' } })).not.toBe('[]')
  })
})

describe('#1459 a connected Table is read whole or by System Managers only', () => {
  const SCHEMA = 'row_rule_source'
  afterAll(() => dropExploreSource(SCHEMA))

  test('without a rule its rows reach no one but a System Manager; with "all", whoever is granted', async ({ admin, createUser }) => {
    await exploreSource(admin, SCHEMA)
    const store = tableRef(EXPLORE_STORE)
    const reader = await createUserWithRole(admin, createUser, { role: ROLE, table: EXPLORE_STORE, can_read: true })
    expect((await reader.get<{ total: number }>(store.url)).total).toBe(3)
    await admin.put(`${store.defUrl}/row_rule`, { row_rule: null })
    expect((await reader.get<{ data: unknown[] }>(store.url)).data).toEqual([])
    await expectRefused(reader.get(store.rowUrl('11')), 403)
    expect((await admin.get<{ data: unknown[] }>(store.url)).data).toHaveLength(3)
    await expectRefused(admin.put(`${store.defUrl}/row_rule`, { row_rule: { kind: 'own' } }), 417)
  })
})
