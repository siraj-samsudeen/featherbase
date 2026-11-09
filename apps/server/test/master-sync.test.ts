// #927: keep a master Table in step with a copied warehouse table. The
// three-way rule is checked exhaustively as a function, then end to end on a
// stand-in warehouse with synthetic rows (never real data).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { tableRelation } from '../src/table-engine'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { discoverPackages } from '../src/runtime-packages'
import { decideColumn, isNotFitting, normalize, toMaster } from '../src/master-sync'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import { expectRefused, grantRole, makeTable } from './fixtures'
import { readFileSync } from 'node:fs'
import { makeClient } from 'feather-testing-postgres'
import { runOneJob } from '../src/jobs'
import { invalidateMeta } from '../src/meta'

describe('the three-way rule for one column', () => {
  // snapshot = last source value seen, source = now, featherbase = now.
  const cases: [string, 'source' | 'featherbase', string | null | undefined, string | null, string | null, ReturnType<typeof decideColumn>][] = [
    ['nothing changed', 'source', 'A', 'A', 'A', { apply: false }],
    ['nothing changed (ours)', 'featherbase', 'A', 'A', 'A', { apply: false }],
    ['source changed, ours unchanged: source-owned is applied', 'source', 'A', 'B', 'A', { apply: true }],
    ['source changed, ours unchanged: Featherbase-owned asks', 'featherbase', 'A', 'B', 'A', { apply: false, raise: 'source_changed' }],
    ['ours changed, source unchanged: source-owned asks to fix the source', 'source', 'A', 'A', 'C', { apply: false, raise: 'edited_here' }],
    ['ours changed, source unchanged: Featherbase-owned is ours', 'featherbase', 'A', 'A', 'C', { apply: false }],
    ['both changed differently: a conflict, source-owned', 'source', 'A', 'B', 'C', { apply: false, raise: 'conflict' }],
    ['both changed differently: a conflict, Featherbase-owned', 'featherbase', 'A', 'B', 'C', { apply: false, raise: 'conflict' }],
    ['both changed to the same value: nothing to do', 'source', 'A', 'B', 'B', { apply: false }],
    ['the source emptied a source-owned value: applied', 'source', 'A', null, 'A', { apply: true }],
    ['the source filled a value it did not have: applied', 'source', null, 'B', null, { apply: true }],
    ['first sync after linking, agreeing', 'source', undefined, 'A', 'A', { apply: false }],
    ['first sync, ours empty: the source fills it', 'source', undefined, 'A', null, { apply: true }],
    ['first sync, disagreeing on a source-owned value: asks, applies nothing', 'source', undefined, 'A', 'C', { apply: false, raise: 'differs_at_link' }],
    ['first sync, disagreeing on ours: ours is kept', 'featherbase', undefined, 'A', 'C', { apply: false }],
  ]
  for (const [title, owner, snapshot, source, featherbase, expected] of cases)
    it(title, () => expect(decideColumn(owner, snapshot, source, featherbase)).toEqual(expected))

  it('compares one spelling per value, read as the master column type', () => {
    expect(normalize('7.000000000', 'Float')).toBe(normalize(7, 'Float'))
    expect(normalize('1', 'Check')).toBe(normalize(true, 'Check'))
    expect(normalize('2026-11-04', 'Date')).toBe(normalize(new Date('2026-11-04T00:00:00Z'), 'Date'))
    expect(normalize('2026-11-04T10:00:00Z', 'Datetime')).toBe(normalize(new Date('2026-11-04T10:00:00.000Z'), 'Datetime'))
  })

  it('stores a source value as the master column does, or says it does not fit', () => {
    expect(toMaster(1, 'Check')).toBe(true)
    expect(toMaster('0', 'Check')).toBe(false)
    expect(isNotFitting(toMaster('maybe', 'Check'))).toBe(true)
    expect(toMaster('7.000000000', 'Int')).toBe(7)
    expect(isNotFitting(toMaster('7.5', 'Int'))).toBe(true)
    expect(toMaster(new Date('2026-11-04T10:00:00Z'), 'Datetime')).toBe('2026-11-04T10:00:00.000Z')
    expect(toMaster(new Date('2026-11-04T00:00:00Z'), 'Date')).toBe('2026-11-04')
    expect(toMaster(42, 'Data')).toBe('42')
    expect(toMaster({ shelf: 3 }, 'JSON')).toEqual({ shelf: 3 })
    expect(isNotFitting(toMaster('2026-02-30', 'Date'))).toBe(true)
    expect(isNotFitting(toMaster('2026/02/30 10:00:00Z', 'Datetime'))).toBe(true)
    expect(toMaster('2026-11-04T00:00:00+05:30', 'Date')).toBe('2026-11-04')
    expect(isNotFitting(toMaster('2026-11-04T25:00:00Z', 'Date'))).toBe(true)
    expect(isNotFitting(toMaster('2026-11-04Tgarbage', 'Date'))).toBe(true)
    expect(normalize('maybe', 'Check')).not.toBe(normalize(false, 'Check'))
    expect(toMaster('', 'JSON')).toBe('')
    expect(normalize(7, 'JSON')).not.toBe(normalize('7', 'JSON'))
    expect(normalize(false, 'JSON')).not.toBe(normalize('false', 'JSON'))
    expect(normalize('')).toBeNull()
    expect(normalize(undefined)).toBeNull()
    expect(normalize(7)).toBe('7')
    expect(normalize({ a: 1 })).toBe('{"a":1}')
    expect(normalize(new Date('2026-11-04T00:00:00Z'), 'Date')).toBe('2026-11-04')
    expect(normalize('abc', 'Int')).toBe('abc')
    expect(normalize('not a date', 'Date')).toBe('not a date')
    expect(normalize('2026-13-01T00:00:00', 'Datetime')).toBe('2026-13-01T00:00:00')
    expect(normalize('2026-11-04T10:00:00Z', 'Date')).toBe('2026-11-04')
    expect(normalize(null, 'JSON')).toBeNull()
    expect(toMaster('', 'Data')).toBeNull()
    expect(toMaster(null, 'JSON')).toBeNull()
    expect(normalize(true)).toBe('true')
    expect(normalize(new Date('2026-11-04T00:00:00Z'))).toBe('2026-11-04T00:00:00.000Z')
  })
})

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir); overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); overrideVariable('MOTHERDUCK_TOKEN', undefined); rmSync(dir, { recursive: true, force: true }) })

const SOURCES = '/api/table/Data%20Source'
const COPY = '/api/table/Sync%20Staff%20Copy'
type Row = Record<string, any>

async function world(admin: TestClient, source: string) {
  await changeStandin(dir, 'sales', [
    `create or replace table ${source} (emp_id varchar, name varchar, phone varchar, role varchar)`,
    `insert into ${source} values ('E1', 'Asha', '111', 'Cashier'), ('E2', 'Bala', '222', 'Packer'), ('E3', 'Chitra', '333', 'Cashier'), ('E4', 'Dev', '444', 'Guard')`,
  ])
  await admin.post(`${SOURCES}:motherduck_connect`, { name: `ms-${source.replaceAll("_", "-")}`, databases: ['sales'] })
  await admin.post(`${SOURCES}/ms-${source.replaceAll("_", "-")}:refresh_tables`, { database: 'sales' })
  await admin.post(`${SOURCES}/ms-${source.replaceAll("_", "-")}:copy_create`, { database: 'sales', schema: 'main', table: source, name: 'Sync Staff Copy', key: 'emp_id',
    columns: ['emp_id', 'name', 'phone', 'role'].map(c => ({ source: c, column_name: c })) })
  // The master Table, its Source Link Table, and the people already linked.
  await makeTable(admin, { name: 'Sync Person', id_pattern: 'prompt', columns: ['full_name', 'phone', 'floor_role', 'employment_status'] })
  await makeTable(admin, { name: 'Sync Source Link', columns: ['source_system', 'key_kind', 'source_key', 'person'] })
  for (const [id, name, phone, role] of [['P1', 'Asha', '111', 'Cashier'], ['P2', 'Bala', '222', 'Packer'], ['P3', 'Chitra', '333', 'Cashier']])
    await admin.post('/api/save_row', { table: 'Sync Person', row: { row_id: id, full_name: name, phone, floor_role: role, employment_status: 'Active' } })
  for (const [key, person] of [['E1', 'P1'], ['E2', 'P2'], ['E3', 'P3']])
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Employee ID', source_key: key, person } })
  // A link from another system with the same key must never be used.
  await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'SAP', key_kind: 'Employee ID', source_key: 'E4', person: 'P1' } })
  await discoverPackages([resolve('../..', 'test-apps/ticket-sink')])
  await admin.post('/api/install_app', { name: 'ticketsink' })
  const rule = {
    master_table: 'Sync Person', source_system: 'StyleHR',
    link: { table: 'Sync Source Link', system_column: 'source_system', key_column: 'source_key', master_column: 'person', kind_column: 'key_kind', kind: 'Employee ID' },
    columns: { full_name: { source: 'name', owner: 'source' }, phone: { source: 'phone', owner: 'source' }, floor_role: { source: 'role', owner: 'featherbase' } },
    inactive: { column: 'employment_status', value: 'Inactive' },
    tickets: { app: 'ticketsink', type: 'source_change', source_system: 'StyleHR' },
  }
  await admin.post(`${COPY}:set_master_sync`, { rule })
  return { source, rule }
}
const run = (admin: TestClient) => admin.post<Row>(`${COPY}:master_sync_run`, {})
const person = (admin: TestClient, id: string) => admin.get<Row>(`/api/table/Sync%20Person/${id}`)
const edit = async (admin: TestClient, id: string, values: Row) =>
  admin.post('/api/save_row', { table: 'Sync Person', row: { row_id: id, updated_at: (await person(admin, id)).updated_at, ...values } })
const sunk = async () => (await sql`select title, kind, payload from ticketsink.ticket order by created_at, row_id`).map(r => ({ ...r, payload: JSON.parse(String(r.payload)) }))
async function sourceChanges(admin: TestClient, source: string, statements: string[]) {
  await changeStandin(dir, 'sales', statements.map(s => s.replaceAll('$T', source)))
  await admin.post(`${SOURCES}/ms-${source.replaceAll("_", "-")}:refresh_tables`, { database: 'sales' })
  return admin.post<Row>(`${COPY}:copy_again`, {})
}

describe('Master sync (#927)', { timeout: 60_000 }, () => {
  test('a first run agrees, and only the new source row is raised: never auto-linked', async ({ admin }) => {
    await world(admin, 'staff_first')
    const first = await run(admin)
    expect(first).toMatchObject({ linked: 3, applied: 0, unchanged: 3, raised: 1, ticket_errors: [] })
    const tickets = await sunk()
    expect(tickets.map(t => t.payload.details.record_key)).toEqual(['E4'])
    expect(tickets[0]).toMatchObject({ kind: 'source_change', payload: { details: { source_system: 'StyleHR' } } })
    expect(tickets[0].payload.original).toMatch(/no link/)
    // A re-run raises nothing again.
    expect(await run(admin)).toMatchObject({ raised: 0, already_raised: 1, tickets: [] })
    expect(await sunk()).toHaveLength(1)
  })

  test('each three-way case: applied with provenance, kept, or raised once', async ({ admin }) => {
    const { source } = await world(admin, 'staff_cases')
    await run(admin)
    // Featherbase edits: Asha's phone (source-owned), Bala's floor role (ours), Chitra's name (both change).
    await edit(admin, 'P1', { phone: '999' })
    await edit(admin, 'P2', { floor_role: 'Supervisor' })
    await edit(admin, 'P3', { full_name: 'Chitra K' })
    const result = (await sourceChanges(admin, source, [
      `update $T set name = 'Asha R' where emp_id = 'E1'`,     // source-owned, ours unchanged → applied
      `update $T set role = 'Billing' where emp_id = 'E3'`,    // Featherbase-owned, ours unchanged → ticket
      `update $T set name = 'Chitra S' where emp_id = 'E3'`,   // both changed → conflict
    ])).master_sync
    expect(result).toMatchObject({ applied: 1, ticket_errors: [] })
    expect(await person(admin, 'P1')).toMatchObject({ full_name: 'Asha R', phone: '999' })
    expect(await person(admin, 'P2')).toMatchObject({ floor_role: 'Supervisor' })
    expect(await person(admin, 'P3')).toMatchObject({ full_name: 'Chitra K', floor_role: 'Cashier' })
    const raised = (await sunk()).slice(1).map(t => [t.payload.details.record_key, t.payload.details.field, t.payload.details.action])
    expect(raised).toEqual(expect.arrayContaining([
      ['P1', 'Phone', expect.stringMatching(/edited in Featherbase/)],
      ['P3', 'Floor Role', expect.stringMatching(/source changed a value Featherbase owns/)],
      ['P3', 'Full Name', expect.stringMatching(/Both the source and Featherbase changed/)],
    ]))
    expect(raised).toHaveLength(3)
    // The applied change says it came from StyleHR, for a later outbound feed to skip.
    const [version] = await sql`select data from version where ref_table = 'Sync Person' and ref_name = 'P1' order by created_at desc limit 1`
    expect(version.data).toMatchObject({ synced_from: 'StyleHR', sync_copied_table: 'Sync Staff Copy' })
    // Run again with nothing new: the same unresolved differences raise nothing.
    const again = await run(admin)
    expect(again).toMatchObject({ applied: 0, raised: 0 })
    expect((await sunk()).length).toBe(4)
    // A different value is a new difference.
    await edit(admin, 'P1', { phone: '998' })
    expect(await run(admin)).toMatchObject({ raised: 1 })
  })

  test('renaming the master, the link Table or a named column keeps the rule working, raising nothing twice (#936)', async ({ admin }) => {
    const { source } = await world(admin, 'staff_renamed')
    await run(admin)
    await edit(admin, 'P1', { phone: '999' })
    expect(await run(admin)).toMatchObject({ raised: 1 })
    const renameTable = (from: string, to: string) => admin.post(`/api/table_def/${encodeURIComponent(from)}/rename`, { to })
    const renameColumn = (table: string, from: string, to: string) =>
      admin.post(`/api/table_def/${encodeURIComponent(table)}/rename_column`, { from, to })
    await renameTable('Sync Person', 'Sync Member')
    await renameColumn('Sync Member', 'phone', 'mobile')
    await renameColumn('Sync Member', 'employment_status', 'standing')
    await renameTable('Sync Source Link', 'Sync Member Link')
    await renameColumn('Sync Member Link', 'person', 'member')
    await renameColumn('Sync Member Link', 'source_key', 'outside_key')
    await renameColumn('Sync Staff Copy', 'name', 'given_name')

    const [stored] = await sql`select rule from featherbase.master_sync where copied_table = 'Sync Staff Copy'`
    expect(stored.rule).toMatchObject({
      master_table: 'Sync Member',
      link: { table: 'Sync Member Link', key_column: 'outside_key', master_column: 'member', system_column: 'source_system', kind_column: 'key_kind' },
      columns: { full_name: { source: 'given_name' }, mobile: { source: 'phone' }, floor_role: { source: 'role' } },
      inactive: { column: 'standing' },
    })
    expect(Object.keys(stored.rule.columns)).not.toContain('phone')
    // The unresolved differences are the same ones: nothing is raised again,
    // and the edited phone keeps its baseline under its new name.
    expect(await run(admin)).toMatchObject({ raised: 0, already_raised: 2, ticket_errors: [] })
    // And a source change still arrives through the renamed columns.
    const result = (await sourceChanges(admin, source, [`update $T set name = 'Asha R' where emp_id = 'E1'`, `delete from $T where emp_id = 'E2'`])).master_sync
    expect(result).toMatchObject({ applied: 2, raised: 0, ticket_errors: [] })
    expect(await admin.get<Row>('/api/table/Sync%20Member/P1')).toMatchObject({ full_name: 'Asha R', mobile: '999' })
    expect(await admin.get<Row>('/api/table/Sync%20Member/P2')).toMatchObject({ standing: 'Inactive' })
    // Renaming the copied table itself raises nothing again either.
    await renameTable('Sync Staff Copy', 'Sync Crew Copy')
    expect(await admin.post<Row>('/api/table/Sync%20Crew%20Copy:master_sync_run', {})).toMatchObject({ raised: 0, ticket_errors: [] })
  })

  test('a row gone from the source marks the master row inactive and deletes nothing; without an inactive column it asks', async ({ admin }) => {
    const { source, rule } = await world(admin, 'staff_gone')
    await run(admin)
    expect((await sourceChanges(admin, source, [`delete from $T where emp_id in ('E2', 'E3', 'E4')`])).master_sync).toMatchObject({ applied: 2 })
    expect(await person(admin, 'P2')).toMatchObject({ employment_status: 'Inactive', full_name: 'Bala' })
    expect(await run(admin)).toMatchObject({ applied: 0, raised: 0 })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, inactive: undefined } })
    await edit(admin, 'P3', { employment_status: 'Active' })
    const asked = await run(admin)
    expect(asked.raised).toBe(2)
    expect((await sunk()).filter(t => /no longer in the source/.test(t.payload.original)).map(t => t.payload.details.record_key).sort()).toEqual(['P2', 'P3'])
    expect(await person(admin, 'P3')).toMatchObject({ employment_status: 'Active' })
  })

  test('a link made later starts from Featherbase: an empty value is filled, a disagreement is asked', async ({ admin }) => {
    await world(admin, 'staff_late')
    await run(admin)
    await admin.post('/api/save_row', { table: 'Sync Person', row: { row_id: 'P4', full_name: 'Devan', employment_status: 'Active' } })
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Employee ID', source_key: 'E4', person: 'P4' } })
    const result = await run(admin)
    expect(result).toMatchObject({ applied: 1, raised: 1 })
    expect(await person(admin, 'P4')).toMatchObject({ full_name: 'Devan', phone: '444', floor_role: null })
    expect((await sunk()).at(-1)!.payload.details).toMatchObject({ record_key: 'P4', field: 'Full Name', current_value: 'Devan', expected_value: 'Dev' })
  })

  test('Copy again also brings the master in step; a changed rule starts again from Featherbase; a master without history is refused', async ({ admin }) => {
    const { source, rule } = await world(admin, 'staff_manual')
    await run(admin)
    const copied = await sourceChanges(admin, source, [`update $T set phone = '113' where emp_id = 'E1'`])
    expect(copied.master_sync).toMatchObject({ applied: 1 })
    expect(await person(admin, 'P1')).toMatchObject({ phone: '113' })
    // A second master Table with the same row ids: the old last-seen values must not decide for it.
    await makeTable(admin, { name: 'Sync Person Two', id_pattern: 'prompt', columns: ['full_name', 'phone', 'floor_role', 'employment_status'] })
    await admin.post('/api/save_row', { table: 'Sync Person Two', row: { row_id: 'P1', full_name: 'Asha', phone: '113', employment_status: 'Active' } })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, master_table: 'Sync Person Two' } })
    await sourceChanges(admin, source, [`update $T set name = 'Asha Two' where emp_id = 'E1'`])
    // Without a last-seen value the name is a disagreement to raise, not an overwrite.
    expect((await admin.get<Row>('/api/table/Sync%20Person%20Two/P1')).full_name).toBe('Asha')
    await makeTable(admin, { name: 'Sync Untracked', id_pattern: 'prompt', columns: ['full_name', 'phone', 'floor_role', 'employment_status'] })
    await sql`update table_def set track_changes = false where name = 'Sync Untracked'`
    invalidateMeta('Sync Untracked')
    await expectRefused(admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, master_table: 'Sync Untracked' } }), 417)
  })

  test('a value the master refuses is raised, and every other row still syncs', async ({ admin }) => {
    const { source } = await world(admin, 'staff_refused')
    await run(admin)
    // The master's phone becomes a required Choice; StyleHR sends one it does not offer.
    await sql`update column_def set column_type = 'Choice', choices = ${'111\n222\n333\n444\n555'} where parent = 'Sync Person' and column_name = 'phone'`
    invalidateMeta('Sync Person')
    const result = (await sourceChanges(admin, source, [
      `update $T set phone = '000' where emp_id = 'E1'`,   // not a choice: raised
      `update $T set phone = '555' where emp_id = 'E2'`,   // a choice: applied
    ])).master_sync
    expect(result).toMatchObject({ applied: 1, ticket_errors: [] })
    expect(await person(admin, 'P1')).toMatchObject({ phone: '111' })
    expect(await person(admin, 'P2')).toMatchObject({ phone: '555' })
    expect((await sunk()).at(-1)!.payload.original).toMatch(/does not fit/)
    // A refused value was not "seen": the same value raises nothing new, and a valid one still applies.
    const before = (await sunk()).length
    expect(await run(admin)).toMatchObject({ applied: 0, raised: 0 })
    expect(await sunk()).toHaveLength(before)
    const later = (await sourceChanges(admin, source, [`update $T set phone = '333' where emp_id = 'E1'`])).master_sync
    expect(later).toMatchObject({ applied: 1, raised: 0 })
    expect(await person(admin, 'P1')).toMatchObject({ phone: '333' })
  })

  test('an inactive value the master refuses is raised; an emptied value reads as empty in its ticket', async ({ admin }) => {
    const { source, rule } = await world(admin, 'staff_empties')
    await run(admin)
    await edit(admin, 'P1', { phone: '' })
    await admin.post(`${COPY}:master_sync_run`, {})
    expect((await sunk()).at(-1)!.payload.original).toMatch(/Featherbase now: \(empty\)/)
    await sql`update column_def set column_type = 'Choice', choices = ${'Active\nLeft'} where parent = 'Sync Person' and column_name = 'employment_status'`
    invalidateMeta('Sync Person')
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, inactive: { column: 'employment_status', value: 'Inactive' } } })
    await changeStandin(dir, 'sales', [`update ${source} set phone = null where emp_id = 'E2'`, `update ${source} set role = null where emp_id = 'E3'`])
    await admin.post(`${SOURCES}/ms-${source.replaceAll('_', '-')}:refresh_tables`, { database: 'sales' })
    await admin.post(`${COPY}:copy_again`, {})
    expect((await sunk()).at(-1)!.payload.original).toMatch(/Source now: \(empty\)/)
    await changeStandin(dir, 'sales', [`delete from ${source} where emp_id = 'E2'`])
    await admin.post(`${SOURCES}/ms-${source.replaceAll('_', '-')}:refresh_tables`, { database: 'sales' })
    const gone = (await admin.post<Row>(`${COPY}:copy_again`, {})).master_sync
    expect(gone).toMatchObject({ applied: 0, raised: 1, ticket_errors: [] })
    expect(await person(admin, 'P2')).toMatchObject({ employment_status: 'Active' })
  })

  test('a master Table owned by an upgraded app syncs from a request that names no app version', async ({ admin }) => {
    const { source, rule } = await world(admin, 'staff_app_master')
    await discoverPackages([resolve('../..', 'test-apps/ticket-sink'), resolve('../..', 'test-apps/action-proof')])
    await admin.post('/api/install_app', { name: 'actionproof' })
    const [{ version }] = (await admin.get<{ installed: { name: string; version: string }[] }>('/api/apps')).installed.filter(app => app.name === 'actionproof')
    const pinned = makeClient({ request: (p, init) => admin.fetch(String(p), { ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `actionproof@${version}` } }) }, admin.token, admin.user)
    await pinned.post('/api/save_row', { table: 'actionproof.work', row: { row_id: 'W1', title: 'Asha' } })
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Work', source_key: 'E1', person: 'W1' } })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, master_table: 'actionproof.work', inactive: undefined,
      link: { ...rule.link, kind: 'Work' }, columns: { title: { source: 'name', owner: 'source' } } } })
    expect(await run(admin)).toMatchObject({ linked: 1, ticket_errors: [] })
    const changed = (await sourceChanges(admin, source, [`update $T set name = 'Asha R' where emp_id = 'E1'`])).master_sync
    expect(changed).toMatchObject({ applied: 1, ticket_errors: [] })
    expect(await pinned.get('/api/table/actionproof.work/W1')).toMatchObject({ title: 'Asha R' })
  })

  test('a copied column named gone is only a column', async ({ admin }) => {
    const { rule } = await world(admin, 'staff_named_gone')
    await admin.post('/api/table_def/Sync%20Staff%20Copy/rename_column', { from: 'role', to: 'gone' })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, columns: { ...rule.columns, floor_role: { source: 'gone', owner: 'featherbase' } } } })
    expect(await run(admin)).toMatchObject({ applied: 0, ticket_errors: [] })
    expect(await person(admin, 'P1')).toMatchObject({ employment_status: 'Active' })
  })

  test('the scheduled refresh of a copy runs its sync rule after the copy', async ({ admin }) => {
    const { source } = await world(admin, 'staff_scheduled')
    await run(admin)
    await changeStandin(dir, 'sales', [`update ${source} set phone = '112' where emp_id = 'E1'`])
    invalidateSources(`ms-${source.replaceAll('_', '-')}`)
    await sql`delete from background_job`
    const schedule = await admin.post<{ method: string }>(`${COPY}:set_copy_schedule`, { enabled: true, cadence: 'hourly' })
    await sql`update background_job set run_at = now() where method = ${schedule.method}`
    expect(await runOneJob()).toBe(true)
    const [execution] = await sql`select outcome, result from job_execution where method = ${schedule.method}`
    expect(execution.outcome).toBe('success')
    expect(String(execution.result)).toContain('master sync: 1 applied')
    expect(await person(admin, 'P1')).toMatchObject({ phone: '112' })
  })

  test("with Tickets itself: a difference becomes a Source Change ticket routed to the source system's primary contact", async ({ admin, createUser }) => {
    const { rule } = await world(admin, 'staff_tickets')
    const tickets = resolve('../..', 'example-apps/tickets')
    const version = JSON.parse(readFileSync(resolve(tickets, 'package.json'), 'utf8')).version
    const pinned = makeClient({ request: (p, init) => admin.fetch(String(p), { ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': `tickets@${version}` } }) }, admin.token, admin.user)
    await discoverPackages([resolve('../..', 'test-apps/ticket-sink'), tickets])
    await admin.post('/api/install_app', { name: 'tickets' })
    const contact = await createUser({ email: 'stylehr.contact@example.test', fullName: 'StyleHR Contact', roles: ['Tickets Support'] })
    await makeTable(admin, { name: 'Sync Source System', id_pattern: 'field:system_name', title_column: 'system_name', columns: ['system_name'] } as any)
    await makeTable(admin, { name: 'Sync Support Contact', columns: [
      { column_name: 'source_system', column_type: 'Reference', reference_table: 'Sync Source System' }, 'person', 'is_primary:Check'] })
    await grantRole(admin, { role: 'All', table: ['Sync Source System', 'Sync Support Contact'], can_read: true })
    const system = await admin.post<Row>('/api/save_row', { table: 'Sync Source System', row: { system_name: 'StyleHR' } })
    await admin.post('/api/save_row', { table: 'Sync Support Contact', row: { source_system: system.row_id, person: contact.user, is_primary: true } })
    for (const [name, value] of [['linked_tables', ['Sync Source System', 'Sync Support Contact']], ['support_users', [contact.user]]] as const)
      await pinned.post('/api/save_row', { table: 'App Setting', row: { row_id: `tickets.${name}`, value: JSON.stringify(value) } })
    const type = await pinned.post<Row>('/api/save_row', { table: 'tickets.ticket_type', row: { type_key: 'source_change', label: 'Source Change', enabled: true,
      states: 'Raised\nDone', done_states: 'Done',
      routing: JSON.stringify({ field: 'source_system', table: 'Sync Support Contact', match: 'source_system', person: 'person', primary: 'is_primary' }) } })
    let order = 0
    for (const [field_name, label, field_type, extra] of [['source_system', 'Source system', 'link', { link_table: 'Sync Source System', link_label: 'system_name' }],
      ['record_key', 'Record', 'text'], ['field', 'Field', 'text'], ['current_value', 'Featherbase value', 'long text'],
      ['expected_value', 'Source value', 'long text'], ['action', 'What to do', 'long text']] as const)
      await pinned.post('/api/save_row', { table: 'tickets.type_field', row: { ticket_type: type.row_id, field_order: ++order, field_name, label, field_type, ...(extra ?? {}) } })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, tickets: { app: 'tickets', type: 'source_change', source_system: String(system.row_id) } } })
    const result = await run(admin)
    expect(result).toMatchObject({ raised: 1, ticket_errors: [] })
    const [ticket] = await sql`select row_id, kind, ticket_state, assigned_to, title from tickets.ticket where row_id = ${result.tickets[0]}`
    expect(ticket).toMatchObject({ kind: 'source_change', ticket_state: 'Raised', assigned_to: contact.user })
    expect(ticket.title).toMatch(/StyleHR/)
  })

  test('a rule is read, removed and checked against the Tables it names', async ({ admin }) => {
    const { rule } = await world(admin, 'staff_rules')
    expect((await admin.get<Row>(`${COPY}:master_sync`)).rule).toMatchObject({ master_table: 'Sync Person' })
    await makeTable(admin, { name: 'Sync Locked', id_pattern: 'prompt', columns: [{ column_name: 'locked', column_type: 'Data', read_only: true }, 'grade:Int'] })
    const set = (changes: Row) => admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, ...changes } })
    const columns = { locked: { source: 'name', owner: 'source' } }
    for (const [changes, message] of [
      [{ master_table: 'Sync Staff Copy' }, /its own master/],
      [{ master_table: 'Sync Locked', columns, inactive: undefined }, /read-only/],
      [{ master_table: 'Sync Locked', columns: { grade: { source: 'phone', owner: 'source' } }, inactive: { column: 'locked', value: 'x' } }, /read-only/],
      [{ master_table: 'Sync Locked', columns: { grade: { source: 'phone', owner: 'source' } }, inactive: { column: 'grade', value: 'x' } }, /does not fit/],
      [{ link: { ...rule.link, kind: undefined } }, /kind/],
      [{ columns: {} }, /at least one column/],
    ] as [Row, RegExp][])
      await expect(set(changes)).rejects.toThrow(message)
    await expectRefused(admin.post(`${COPY}:set_master_sync`, {}), 417)
    await expectRefused(admin.post(`${COPY}:set_master_sync`, { rule: 'not a rule' }), 417)
    // A column may come from the copied row's own key; a link may name no key kind.
    await set({ columns: { phone: { source: 'row_id', owner: 'featherbase' } } })
    await admin.post(`${COPY}:set_master_sync`, { rule: null })
    expect((await admin.get<Row>(`${COPY}:master_sync`)).rule).toBeNull()
    await expectRefused(run(admin), 404)
    expect((await admin.post<Row>(`${COPY}:copy_again`, {})).master_sync).toBeUndefined()
  })

  test('awkward links and values: an empty link is skipped, two links are raised, a value that does not fit is raised', async ({ admin }) => {
    const { rule } = await world(admin, 'staff_awkward')
    await run(admin)
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Employee ID', source_key: 'E9', person: '' } })
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Employee ID', source_key: 'E2', person: 'P3' } })
    await admin.post('/api/save_row', { table: 'Sync Source Link', row: { source_system: 'StyleHR', key_kind: 'Employee ID', source_key: 'E4', person: 'P-gone' } })
    const result = await run(admin)
    expect(result).toMatchObject({ ticket_errors: [] })
    const originals = (await sunk()).map(t => t.payload.original).join('\n')
    expect(originals).toMatch(/more than one Featherbase row/)
    expect(originals).toMatch(/does not exist/)
    await makeTable(admin, { name: 'Sync Graded', id_pattern: 'prompt', columns: ['grade:Int'] })
    await admin.post('/api/save_row', { table: 'Sync Graded', row: { row_id: 'P1' } })
    await admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, master_table: 'Sync Graded', columns: { grade: { source: 'name', owner: 'source' } }, inactive: undefined,
      link: { table: rule.link.table, system_column: rule.link.system_column, key_column: rule.link.key_column, master_column: rule.link.master_column },
      tickets: { app: rule.tickets.app, type: rule.tickets.type } } })
    const graded = await run(admin)
    expect(graded).toMatchObject({ applied: 0, ticket_errors: [] })
    expect((await sunk()).map(t => t.payload.original).join('\n')).toMatch(/does not fit the Featherbase column/)
  })

  test('a run refuses a master that stopped keeping history, and a failure that is not a refused value stops the run', async ({ admin }) => {
    const { source } = await world(admin, 'staff_failures')
    await run(admin)
    await sql`update table_def set track_changes = false where name = 'Sync Person'`
    invalidateMeta('Sync Person')
    await expectRefused(run(admin), 417)
    await sql`update table_def set track_changes = true where name = 'Sync Person'`
    invalidateMeta('Sync Person')
    // A column that became read-only is refused too: a save would silently drop it and the baseline would move on.
    await sql`update column_def set read_only = true where parent = 'Sync Person' and column_name = 'phone'`
    invalidateMeta('Sync Person')
    await expectRefused(run(admin), 417)
    await sql`update column_def set read_only = false where parent = 'Sync Person' and column_name = 'phone'`
    invalidateMeta('Sync Person')
    await changeStandin(dir, 'sales', [`update ${source} set phone = '114' where emp_id = 'E1'`])
    await admin.post(`${SOURCES}/ms-${source.replaceAll('_', '-')}:refresh_tables`, { database: 'sales' })
    await sql.unsafe(`create function featherbase.ms_refuse() returns trigger language plpgsql as $$ begin raise exception 'Injected save failure'; end $$`)
    await sql.unsafe(`create trigger ms_refuse before update on ${await tableRelation('Sync Person')} for each row execute function featherbase.ms_refuse()`)
    await expect(admin.post(`${COPY}:copy_again`, {})).rejects.toBeDefined()
    expect(await person(admin, 'P1')).toMatchObject({ phone: '111' })
  })

  test('a ticket that cannot be raised is kept and raised on the next run; only a System Manager sets or runs a rule', async ({ admin, createUser }) => {
    const { rule } = await world(admin, 'staff_retry')
    await admin.post('/api/set_app_enabled', { name: 'ticketsink', enabled: false })
    const failed = await run(admin)
    expect(failed.raised).toBe(1)
    expect(failed.ticket_errors).toHaveLength(1)
    await admin.post('/api/set_app_enabled', { name: 'ticketsink', enabled: true })
    const retried = await run(admin)
    expect(retried).toMatchObject({ raised: 0, ticket_errors: [] })
    expect(retried.tickets).toHaveLength(1)
    expect(await sunk()).toHaveLength(1)
    const clerk = await createUser({ roles: ['All'] })
    await expectRefused(clerk.post(`${COPY}:master_sync_run`, {}), 403)
    await expectRefused(clerk.post(`${COPY}:set_master_sync`, { rule }), 403)
    await expectRefused(admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, columns: { nope: { source: 'name', owner: 'source' } } } }), 417)
    await expectRefused(admin.post(`${COPY}:set_master_sync`, { rule: { ...rule, columns: { full_name: { source: 'name', owner: 'everyone' } } } }), 417)
    await expectRefused(admin.post('/api/table/Sync%20Person:set_master_sync', { rule }), 404)
  })
})
