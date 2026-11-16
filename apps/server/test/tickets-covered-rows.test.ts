// #1230: a data quality ticket lists the Data Quality Rows it covers, to everyone who can see the
// ticket, read as a declared base Table; beyond the spec's scenarios (test/scenarios/).
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { test as pgTest } from './pg-test'
import { expectStatus } from './fixtures'
import { sql } from '../src/db'
import { loadInstalledApps } from '../src/apps'
import { discoverPackages } from '../src/runtime-packages'
import { pinning, TicketCoveredRows, Tickets, TICKETS_DIRECTORY, TICKETS_VERSION } from './tickets-world'

const test = pgTest.extend(pinning)
const world = async (admin: ConstructorParameters<typeof Tickets>[0], createUser: ConstructorParameters<typeof Tickets>[1], link = true) => {
  const x = new TicketCoveredRows(new Tickets(admin, createUser))
  await x.world({ link })
  return x
}

describe('a ticket lists the rows it covers (#1230)', () => {
  test('the raiser, the assignee and any other reader see the same rows: open first, then fixed', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    for (const actor of ['Anjali', 'Bala', 'Colleague']) {
      const covered = await x.covered(actor)
      expect(covered, actor).toMatchObject({ total: 3, fixed: 1 })
      expect(covered!.rows.map(r => [r.table, r.row, r.note, r.fixed_on]), actor).toEqual([
        ['Merchandise Assignment', 'Every buyer row with no person', null, null],
        ['Section', x.sections['North Grocery'], 'Mixes grocery with home', null],
        ['Section', x.sections['South Fashion'], 'Mixes grocery with fashion', '2026-11-07'],
      ])
    }
  })

  test("another ticket's rows, and columns the page does not show, are never sent", async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    const text = JSON.stringify(await x.t.open('Colleague'))
    expect(text).not.toContain('OTHER-TICKET-ROW-1230')
    expect(text).not.toContain('FIXER-SECRET-1230')
    for (const row of (await x.covered('Colleague'))!.rows) expect(Object.keys(row).sort()).toEqual(['fixed_on', 'link', 'note', 'record', 'row', 'table'])
  })

  test('a row links only for a viewer who may read it as themself, and only when it exists', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    const links = async (actor: string) => (await x.covered(actor))!.rows.map(r => [r.row, r.link])
    // Bala (Tickets support) reads Section; the Merchandise Assignment line names no row of a linked Table.
    expect(await links('Bala')).toEqual([['Every buyer row with no person', false], [x.sections['North Grocery'], true], [x.sections['South Fashion'], true]])
    for (const actor of ['Anjali', 'Colleague']) expect((await links(actor)).every(([, link]) => link === false), actor).toBe(true)
  })

  test("each line names its Data Quality Row record only to a viewer who may open it", async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    // Nobody holds a grant on Data Quality Row yet: Tickets still lists the rows, and no line names its record.
    for (const actor of ['Anjali', 'Bala']) expect((await x.covered(actor))!.rows.every(r => r.record === null), actor).toBe(true)
    await x.grantRows()
    const records = (await x.covered('Bala'))!.rows.map(r => r.record)
    expect(records.every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(records).size).toBe(3)
    expect((await x.covered('Anjali'))!.rows.every(r => r.record === null)).toBe(true)
  })

  test('someone who may not see the ticket is refused, and gets no rows', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    // Every signed-in person holds All, which reads tickets; someone who has left no longer can.
    await x.t.person('Leaver', ['All'])
    await sql`update person set enabled = false where row_id = ${x.t.ids.Leaver}`
    const reply = await x.t.call('Leaver', '/api/app_reads/tickets/detail', { payload: { row_id: x.t.ticket.row_id } })
    expect(reply.status).not.toBe(200)
    expect(JSON.stringify(reply.body)).not.toContain('Mixes grocery')
    // A ticket that is not there is refused before any row is read.
    const missing = await x.t.call('Bala', '/api/app_reads/tickets/detail', { payload: { row_id: 'FT-99999' } })
    expect(missing.status).not.toBe(200)
  })

  test('until Data Quality Row is a linked Table the page opens without the list; support is told how to show it', async ({ admin, createUser }) => {
    const x = await world(admin, createUser, false)
    for (const actor of ['Anjali', 'Colleague']) {
      const detail = await x.t.open(actor)
      expect(detail.coveredRows, actor).toBeUndefined()
      expect(detail.coveredRowsSetup, actor).toBeUndefined()
    }
    const support = await x.t.open('Bala')
    expect(support.coveredRows).toBeUndefined()
    expect(support.coveredRowsSetup).toMatch(/Data Quality Row.*linked_tables/)
  })

  // Codex adversarial, round 1: a linked Table that no longer fits must not take every ticket page down.
  test('a linked Data Quality Row that was deleted leaves every ticket page working', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await expectStatus(await admin.fetch(`/api/table_def/${encodeURIComponent(x.table)}`, { method: 'DELETE' }), 200)
    for (const actor of ['Anjali', 'Bala']) expect((await x.t.open(actor)).coveredRows, actor).toBeUndefined()
    expect((await x.t.open('Bala')).coveredRowsSetup).toMatch(/Data Quality Row/)
  })

  test('a Data Quality Row missing a column Tickets reads leaves every ticket page working', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await expectStatus(await admin.fetch(`/api/table_def/${encodeURIComponent(x.table)}`, {
      method: 'PUT', body: JSON.stringify({ columns: x.columns.filter(c => c.column_name !== 'note'), remove_columns: ['note'] }) }), 200)
    expect((await x.t.open('Anjali')).coveredRows).toBeUndefined()
    expect((await x.t.open('Bala')).coveredRowsSetup).toMatch(/Data Quality Row/)
  })

  test('a ticket with no rows has no list', async ({ admin, createUser }) => {
    const x = await world(admin, createUser)
    await x.transitions.types.submit({ urgency: 'Later', source_system: x.transitions.types.systems.SAP })
    expect(await x.covered('Anjali')).toBeUndefined()
    expect((await x.t.open('Bala')).coveredRowsSetup).toBeUndefined()
  })
})

describe('Tickets declares Data Quality Row as a base Table (#1230)', () => {
  test('it reads exactly the five columns the page shows', async () => {
    const manifest = JSON.parse(await readFile(resolve(TICKETS_DIRECTORY, 'featherbase.json'), 'utf8'))
    expect(manifest.baseTables).toEqual({ read: { 'Data Quality Row': ['ticket', 'affected_table', 'affected_row', 'fixed_on', 'note'] } })
  })

  test("Tickets upgrades from production's 0.2.9 with no Table and no grant added", async ({ admin }) => {
    const manifest = JSON.parse(await readFile(resolve(TICKETS_DIRECTORY, 'featherbase.json'), 'utf8'))
    // #1227's 0.2.11 (no Table change) follows covered_rows: upgrade from 0.2.9
    // across this step and every later one, to the version shipped now.
    const step = manifest.migrations.find((m: any) => m.id === 'covered_rows')
    expect(step).toMatchObject({ id: 'covered_rows', toVersion: '0.2.10', operations: [] })
    const later = manifest.migrations.slice(manifest.migrations.indexOf(step))
    expect(later.slice(1).every((m: any) => m.operations.length === 0)).toBe(true)
    const prior = await mkdtemp(resolve('test/.upgrade-tickets-1230-'))
    try {
      await cp(TICKETS_DIRECTORY, prior, { recursive: true, filter: source => !source.includes('node_modules') })
      // 0.2.9 as production runs it: no base Table read and no step past it.
      const { baseTables: _, ...rest } = manifest
      await writeFile(resolve(prior, 'featherbase.json'), JSON.stringify({ ...rest, migrations: manifest.migrations.filter((m: any) => !later.includes(m)) }))
      await writeFile(resolve(prior, 'package.json'), JSON.stringify({ ...JSON.parse(await readFile(resolve(TICKETS_DIRECTORY, 'package.json'), 'utf8')), version: step.fromVersion }))
      expect(step.fromVersion).toBe('0.2.9')
      await discoverPackages([prior])
      await admin.post('/api/install_app', { name: 'tickets' })
      const before = (await sql`select count(*)::int as n from permission where ref_table like 'tickets.%'`)[0].n
      await discoverPackages([prior, TICKETS_DIRECTORY])
      await loadInstalledApps()
      const plan = await admin.post<any>('/api/preview_app_upgrade', { name: 'tickets', version: TICKETS_VERSION })
      expect(plan).toMatchObject({ currentVersion: '0.2.9', targetVersion: TICKETS_VERSION, destructive: false, tables: [], permissions: [] })
      await admin.post('/api/upgrade_app', { name: 'tickets', version: TICKETS_VERSION, planId: plan.planId })
      await admin.post('/api/activate_app_upgrade', { name: 'tickets', version: TICKETS_VERSION })
      const [installed] = await sql`select package_version, activation_pending, manifest->'baseTables' as base from installed_app where name = 'tickets'`
      expect(installed).toMatchObject({ package_version: TICKETS_VERSION, activation_pending: false, base: manifest.baseTables })
      expect((await sql`select count(*)::int as n from permission where ref_table like 'tickets.%'`)[0].n).toBe(before)
    } finally { await rm(prior, { recursive: true, force: true }) }
  })
})

// Codex (standard and adversarial, round 1): the platform caps a page at 500, so a lookup of one page
// would leave the 501st readable row unlinked. Tickets' read against a context that pages as the platform does.
describe('the covered-row lookups read every page (#1230)', () => {
  it('a ticket covering 600 readable rows links all 600 and names all 600 records', async () => {
    const { reads } = await import(resolve(TICKETS_DIRECTORY, 'dist/server.mjs'))
    const N = 600
    const dq = Array.from({ length: N }, (_, i) => ({ row_id: `DQ-${String(i).padStart(4, '0')}`, ticket: 'FT-1', affected_table: 'Section',
      affected_row: `S-${String(i).padStart(4, '0')}`, fixed_on: null, note: null }))
    const page = (rows: Record<string, unknown>[], args: any) => {
      const filters = (args.filters ?? []) as [string, string, unknown][]
      const kept = rows.filter(row => filters.every(([column, op, value]) => op === 'in' ? (value as unknown[]).includes(row[column]) : row[column] === value))
      const start = args.limit_start ?? 0
      return kept.slice(start, start + Math.min(args.limit_page_length ?? 20, 500))
    }
    const tables: Record<string, Record<string, unknown>[]> = { 'Data Quality Row': dq, Section: dq.map(row => ({ row_id: row.affected_row })) }
    const documents = {
      get: async (table: string, id: string) => ({ row_id: id, title: 'A ticket', owner: 'psn_raiser', kind: 'data_quality_issue', ticket_state: 'Raised', updated_at: 'r1' }),
      list: async (table: string, args: any) => page(tables[table] ?? [], args),
      count: async (table: string, filters: any) => (tables[table] ?? []).filter(row => (filters as [string, string, unknown][]).every(([c, op, v]) => op === 'in' ? (v as unknown[]).includes(row[c]) : row[c] === v)).length,
      isReader: async () => false,
    }
    const ctx = { user: 'psn_reader', userName: 'Reader', roles: ['All'], payload: { row_id: 'FT-1' }, reject: (m: string) => { throw new Error(m) },
      settings: { linked_tables: JSON.stringify(['Data Quality Row', 'Section']) }, people: { names: async () => ({}), enabled: async () => [] }, documents,
      baseTables: { available: async () => true, list: async (table: string, args: any) => page(tables[table], args) } }
    const { answer } = await reads.detail(ctx)
    expect(answer.coveredRows.total).toBe(N)
    expect(answer.coveredRows.rows.filter((r: any) => r.link)).toHaveLength(N)
    expect(answer.coveredRows.rows.filter((r: any) => r.record)).toHaveLength(N)
  })
})
