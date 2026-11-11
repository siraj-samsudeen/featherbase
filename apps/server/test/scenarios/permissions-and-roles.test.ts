// permissions-and-roles' fenced scenarios (#1184), against the real in-process
// server. Each test is one scenario of openspec/specs/permissions-and-roles/spec.md,
// step by step: what a role grants, how a row or a column is held back, what
// only a System Manager may do, and what the release refuses to ship.
import { resolve } from 'node:path'
import { afterEach, describe, expect, onTestFinished, vi } from 'vitest'
import postgres from 'postgres'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test, patchDoc } from '../pg-test'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, grantRole, makePerson, makeTable, tableRef, type TableRef } from '../fixtures'
import { scenarioFor } from '../scenario'
import { sql } from '../../src/db'
import { config } from '../../src/config'
import { setUserPassword } from '../../src/auth'
import { saveDoc } from '../../src/document'
import { getRoles } from '../../src/permissions'
import { renderPrintHtml } from '../../src/print'
import { parseInstanceAddresses } from '../../src/instance-addresses'
import { preflightRelease } from '../../src/release-preflight'
import { discoverPackages } from '../../src/runtime-packages'
import { invalidateSources } from '../../src/sources/registry'
import { EXTERNAL_DATABASE_URL } from '../external-database'
const scenario = scenarioFor(test, 'permissions-and-roles')

type Row = Record<string, any>
const enc = encodeURIComponent
const ALL_ACTIONS = { can_read: true, can_write: true, can_create: true, can_delete: true }
const PERSON = tableRef('Person')
const personRow = (admin: TestClient, id: string) =>
  admin.get<Row & { roles: { row_id: string; role: string }[] }>(PERSON.rowUrl(id))
const listOf = async (client: TestClient, url: string) => (await client.get<{ data: Row[]; total: number }>(url)).data


// An installed app stays loaded in this process after its rows roll back.
afterEach(async () => {
  await discoverPackages([])
})

type Caps = { manage: boolean; admin: boolean; own_grant: boolean; tables: string[] }
const capsOf = async (client: TestClient) => (await client.get<{ capabilities: Caps }>('/api/whoami')).capabilities

const DASH_STAND_IN = resolve('../..', 'test-apps/fixtures/dash-stand-in')
const EVOLVE = resolve('../..', 'test-apps/fixtures/evolve-v1')
const APP_TABLE = 'dash.note'
const DASH_ROLE = 'Dash Reader'

const NOTES = 'Er Notes'
const MEMBER = 'Tasker Member'
const notes = `/api/table/${encodeURIComponent(NOTES)}`
const setEveryone = (client: TestClient, roles: string | null) =>
  client.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: roles } })
const settings = (client: TestClient) => client.get<{ everyone_roles: string | null }>('/api/table/System%20Settings/System%20Settings')
async function memberRole(admin: TestClient) {
  await makeTable(admin, { name: NOTES, columns: ['note'] })
  await grantRole(admin, { role: MEMBER, table: NOTES, can_read: true })
}

const STORE = 'Sr Store'
const SECTION = 'Sr Section'
const SR_ROLE = 'Sr Role'
interface World { user: TestClient; section: TableRef; rowOf: (title: string) => Promise<string> }

/** The Stores and Sections tables (def shapes the narrowing), with sections n (North, supplied by South), s (South) and none. */
async function sectionsTable(admin: TestClient, def: Record<string, unknown>) {
  await makeTable(admin, { name: STORE, id_pattern: 'prompt', columns: ['city'] })
  const section = await makeTable(admin, {
    name: SECTION,
    columns: [
      'title',
      { column_name: 'store', column_type: 'Reference', reference_table: STORE },
      { column_name: 'supplier_store', column_type: 'Reference', reference_table: STORE },
    ],
    ...def,
  })
  for (const s of ['North', 'South']) await admin.post('/api/save_row', { table: STORE, row: { row_id: s } })
  for (const [title, s, supplier] of [['n', 'North', 'South'], ['s', 'South', 'North'], ['none', null, null]])
    await admin.post('/api/save_row', { table: SECTION, row: { title, store: s, supplier_store: supplier } })
  return section
}

/** A store manager who may do everything on both tables, narrowed by these Data Scope rows (none: no narrowing). */
async function storeManager(
  admin: TestClient,
  createUser: CreateUserFn,
  section: TableRef,
  scopes: { allow_table: string; for_value: string }[],
): Promise<World> {
  const user = await createUserWithRole(admin, createUser, {
    role: SR_ROLE, table: [SECTION, STORE], can_read: true, can_write: true, can_create: true, can_delete: true,
  })
  for (const scope of scopes) await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, ...scope } })
  const rowOf = async (title: string) =>
    String((await sql.unsafe(`select row_id from featherbase.sr_section where title = $1`, [title]))[0].row_id)
  return { user, section, rowOf }
}

const listed = async (client: TestClient, table: TableRef) =>
  (await client.get<{ data: { title: string; store: string | null; supplier_store: string | null }[] }>(
    table.listUrl({ fields: ['title', 'store', 'supplier_store'] }))).data

const DT = 'Untick Doc'
const UT_ROLE = 'Untick Role'
const utList = `/api/table/${encodeURIComponent(DT)}`
async function editedReadGrant(admin: TestClient) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: UT_ROLE } })
  const read = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Permission', row: { ref_table: DT, role: UT_ROLE, operation: 'read', scope_mode: 'all' },
  })
  // Two saved edits that end where they began: two history entries.
  for (const scope_mode of ['creator', 'all']) {
    const row = await admin.get<Record<string, unknown>>(`/api/table/Permission/${read.row_id}`)
    await admin.post('/api/save_row', { table: 'Permission', row: { ...row, scope_mode } })
  }
  return read.row_id
}
const untickRead = (client: TestClient) =>
  client.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: UT_ROLE, can_read: false }),
  })
const historyOf = async (client: TestClient, id: string) => {
  const filters = encodeURIComponent(JSON.stringify([['ref_table', '=', 'Permission'], ['ref_name', '=', id]]))
  const fields = encodeURIComponent(JSON.stringify(['data', 'created_by', 'created_at']))
  const { data } = await client.get<{ data: { data: { changed: [string, unknown, unknown][] }; created_by: string; created_at: string }[] }>(
    `/api/table/Version?fields=${fields}&filters=${filters}&limit=50`)
  // Oldest first: the list itself comes newest first.
  return data.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

describe('permissions-and-roles', () => {
  scenario('A fresh table needs no setup', async ({ admin, createUser }, step) => {
    let memos!: ReturnType<typeof tableRef>
    let manager!: TestClient
    let opened!: Response
    await step('a table "Memos" with no permissions configured for it at all', async () => {
      memos = await makeTable(admin, { name: 'Memos', id_pattern: 'prompt', columns: ['title'] })
      await admin.post(memos.url, { row_id: 'M-1', title: 'first' })
      expect(await sql`select 1 from permission where ref_table = 'Memos'`).toHaveLength(0)
    })
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user opens "Memos"', async () => {
      opened = await manager.fetch(memos.listUrl({ fields: ['row_id', 'title'] }))
    })
    await step('the user can read its rows', async () => {
      await expectStatus(opened, 200)
      const { data } = (await opened.json()) as { data: Row[] }
      expect(data.map((row) => row.row_id)).toContain('M-1')
    })
    await step('the user can create a row', async () => {
      const created = await manager.fetch(memos.url, { method: 'POST', body: JSON.stringify({ row_id: 'M-2', title: 'second' }) })
      await expectStatus(created, 201)
    })
    await step('the user can edit a row', async () => {
      const row = await manager.get<Row>(memos.rowUrl('M-1'))
      await patchDoc(manager, memos.rowUrl('M-1'), { updated_at: row.updated_at, title: 'edited' })
      expect((await manager.get<Row>(memos.rowUrl('M-1'))).title).toBe('edited')
    })
    await step('the user can delete a row', async () => {
      // The edited row now has history, which blocks deleting it (#321); the
      // untouched second row shows the manager may delete.
      await expectStatus(await manager.fetch(memos.rowUrl('M-2'), { method: 'DELETE' }), 200)
      await expectRefused(admin.get(memos.rowUrl('M-2')), 404)
    })
  })

  scenario('No delete grant', async ({ admin, createUser }, step) => {
    let memos!: ReturnType<typeof tableRef>
    let user!: TestClient
    let attempt!: Response
    await step('a table "Memos" with a row "M-1"', async () => {
      memos = await makeTable(admin, { name: 'Memos', id_pattern: 'prompt', columns: ['title'] })
      await admin.post(memos.url, { row_id: 'M-1', title: 'first' })
    })
    await step('the user\'s roles are granted read and write on "Memos", but not delete', async () => {
      user = await createUserWithRole(admin, createUser, { role: 'Memo Editor', table: 'Memos', can_read: true, can_write: true })
    })
    await step('the user tries to delete "M-1"', async () => {
      attempt = await user.fetch(memos.rowUrl('M-1'), { method: 'DELETE' })
    })
    await step('the deletion is refused', async () => {
      await expectRefused(attempt, 403)
    })
  })

  scenario('Granting read takes effect at once', async ({ admin, createUser }, step) => {
    const list = `/api/table/${enc('Memos')}`
    const matrix = `/api/permissions/${enc('Memos')}`
    let holder!: TestClient
    let manager!: TestClient
    await step('a role with no read access to a table "Memos"', async () => {
      await makeTable(admin, { name: 'Memos', columns: ['title'] })
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Memo Reader' } })
      expect(await sql`select 1 from permission where ref_table = 'Memos' and role = 'Memo Reader'`).toHaveLength(0)
    })
    await step('the user holds that role and is signed in', async () => {
      holder = await createUser({ roles: ['Memo Reader'] })
      manager = await createUser({ roles: ['System Manager'] })
      await expectRefused(holder.get(list), 403)
    })
    await step('a System Manager gives the role read access to "Memos"', async () => {
      await manager.post(matrix, { role: 'Memo Reader', can_read: true })
    })
    await step('the user\'s next attempt to open the list of "Memos" succeeds', async () => {
      await expectStatus(await holder.fetch(list), 200)
    })
    await step('a System Manager takes that read access away', async () => {
      await manager.post(matrix, { role: 'Memo Reader', can_read: false })
    })
    await step('the user\'s next attempt to open the list of "Memos" is refused', async () => {
      await expectRefused(holder.get(list), 403)
    })
  })

  scenario('Limited to your own rows', async ({ admin, createUser }, step) => {
    let notes!: ReturnType<typeof tableRef>
    let user!: TestClient
    let opened!: Response
    let edit!: Response
    await step('a table "Notes" with a row "N-1" created by someone else', async () => {
      notes = await makeTable(admin, { name: 'Notes', id_pattern: 'prompt', columns: ['body'] })
      await admin.post(notes.url, { row_id: 'N-1', body: 'not yours' })
      expect((await admin.get<Row>(notes.rowUrl('N-1'))).created_by).toBe('Administrator')
    })
    await step('the user may read every row of "Notes"', async () => {
      await grantRole(admin, { role: 'Note Reader', table: 'Notes', can_read: true })
    })
    await step('the user holds a write grant on "Notes" limited to rows they created', async () => {
      await grantRole(admin, { role: 'Note Writer', table: 'Notes', own_rows_only: true, can_write: true })
      user = await createUser({ roles: ['Note Reader', 'Note Writer'] })
    })
    await step('the user opens "N-1" and tries to edit it', async () => {
      opened = await user.fetch(notes.rowUrl('N-1'))
      const row = await admin.get<Row>(notes.rowUrl('N-1'))
      edit = await user.fetch(notes.rowUrl('N-1'), { method: 'PATCH', body: JSON.stringify({ updated_at: row.updated_at, body: 'taken over' }) })
    })
    await step('the edit is refused', async () => {
      await expectStatus(opened, 200)
      await expectRefused(edit, 403)
      expect((await admin.get<Row>(notes.rowUrl('N-1'))).body).toBe('not yours')
    })
  })

  /** Customers Asha (north) and Bram (south), and a user who may read customers and orders. */
  async function regionalWorld(admin: TestClient, createUser: Parameters<typeof createUserWithRole>[1]) {
    const customers = await makeTable(admin, { name: 'Customers', id_pattern: 'prompt', columns: ['region'] })
    const orders = await makeTable(admin, {
      name: 'Orders', id_pattern: 'prompt',
      columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Customers' }],
    })
    await admin.post(customers.url, { row_id: 'Asha', region: 'north' })
    await admin.post(customers.url, { row_id: 'Bram', region: 'south' })
    const user = await createUserWithRole(admin, createUser, { role: 'Regional Reader', table: ['Customers', 'Orders'], can_read: true })
    const narrowToNorth = async () => {
      const north = await listOf(admin, customers.listUrl({ fields: ['row_id'], filters: [['region', '=', 'north']] }))
      expect(north.map((row) => row.row_id)).toEqual(['Asha'])
      await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: 'Customers', for_value: 'Asha' } })
    }
    return { customers, orders, user, narrowToNorth }
  }

  scenario("Narrowed to one region's rows", async ({ admin, createUser }, step) => {
    let world!: Awaited<ReturnType<typeof regionalWorld>>
    let seen!: Row[]
    await step('customers "Asha" in the north and "Bram" in the south', async () => {
      world = await regionalWorld(admin, createUser)
    })
    await step('orders "O-1" for Asha and "O-2" for Bram', async () => {
      await admin.post(world.orders.url, { row_id: 'O-1', customer: 'Asha' })
      await admin.post(world.orders.url, { row_id: 'O-2', customer: 'Bram' })
    })
    await step('the user\'s access to Customers is narrowed to the customers in the north', async () => {
      await world.narrowToNorth()
    })
    await step('the user opens the full customer list', async () => {
      seen = await listOf(world.user, world.customers.url)
    })
    await step('the user sees only Asha', async () => {
      expect(seen.map((row) => row.row_id)).toEqual(['Asha'])
    })
    await step('the list of orders hides "O-2"', async () => {
      const orders = await listOf(world.user, world.orders.listUrl({ fields: ['row_id', 'customer'] }))
      expect(orders.map((row) => row.row_id)).toEqual(['O-1'])
    })
  })

  scenario('A row that names no customer stays visible', async ({ admin, createUser }, step) => {
    let world!: Awaited<ReturnType<typeof regionalWorld>>
    let seen!: string[]
    await step('the user\'s access to Customers is narrowed to the customers in the north', async () => {
      world = await regionalWorld(admin, createUser)
      await world.narrowToNorth()
    })
    await step('an order "O-1" for a customer in the north, an order "O-2" for one in the south, and an order "O-3" that names no customer', async () => {
      await admin.post(world.orders.url, { row_id: 'O-1', customer: 'Asha' })
      await admin.post(world.orders.url, { row_id: 'O-2', customer: 'Bram' })
      await admin.post(world.orders.url, { row_id: 'O-3', customer: null })
    })
    await step('the user opens the list of orders', async () => {
      const orders = await listOf(world.user, world.orders.listUrl({ fields: ['row_id', 'customer'] }))
      seen = orders.map((row) => row.row_id).sort()
    })
    await step('the user sees "O-1" and "O-3"', async () => {
      expect(seen).toEqual(expect.arrayContaining(['O-1', 'O-3']))
    })
    await step('the user does not see "O-2"', async () => {
      expect(seen).toEqual(['O-1', 'O-3'])
    })
  })

  scenario('Shared with someone outside the role grant', async ({ admin, createUser }, step) => {
    let memos!: ReturnType<typeof tableRef>
    let user!: TestClient
    await step('a table "Memos" with rows "M-1" and "M-2"', async () => {
      memos = await makeTable(admin, { name: 'Memos', id_pattern: 'prompt', columns: ['body'] })
      await admin.post(memos.url, { row_id: 'M-1', body: 'first memo' })
      await admin.post(memos.url, { row_id: 'M-2', body: 'second memo' })
    })
    await step('the user has no write grant on "Memos"', async () => {
      user = await createUser({ roles: [] })
      expect(await sql`select 1 from permission where ref_table = 'Memos'`).toHaveLength(0)
    })
    await step('a System Manager shares "M-1" with the user for editing', async () => {
      const manager = await createUser({ roles: ['System Manager'] })
      await manager.post('/api/save_row', { table: 'Share', row: { share_table: 'Memos', share_name: 'M-1', person: user.user, read: true, write: true } })
    })
    await step('the user can edit "M-1"', async () => {
      const row = await admin.get<Row>(memos.rowUrl('M-1'))
      await patchDoc(user, memos.rowUrl('M-1'), { updated_at: row.updated_at, body: 'edited by sharee' })
      expect((await admin.get<Row>(memos.rowUrl('M-1'))).body).toBe('edited by sharee')
    })
    await step('the user cannot edit "M-2"', async () => {
      const other = await admin.get<Row>(memos.rowUrl('M-2'))
      await expectApiError(patchDoc(user, memos.rowUrl('M-2'), { updated_at: other.updated_at, body: 'not mine' }), { status: 403 })
      expect((await admin.get<Row>(memos.rowUrl('M-2'))).body).toBe('second memo')
    })
  })

  scenario('A sensitive column is hidden', async ({ admin, createUser }, step) => {
    let employees!: ReturnType<typeof tableRef>
    let user!: TestClient
    let opened!: Row
    await step('an employee row "Alice" whose salary is a sensitive column', async () => {
      employees = await makeTable(admin, {
        name: 'Employees', id_pattern: 'prompt',
        columns: ['employee', { column_name: 'salary', column_type: 'Currency', tier: 'restricted' }],
      })
      await admin.post(employees.url, { row_id: 'Alice', employee: 'Alice', salary: 5000 })
      expect(Number((await admin.get<Row>(employees.rowUrl('Alice'))).salary)).toBe(5000)
    })
    await step('the user does not have the deeper access the salary requires', async () => {
      user = await createUserWithRole(admin, createUser, { role: 'Employee Reader', table: 'Employees', tier: 'basic', can_read: true })
    })
    await step('the user opens "Alice"', async () => {
      opened = await user.get<Row>(employees.rowUrl('Alice'))
    })
    await step('the salary is absent from what the user sees, not shown blank or masked', async () => {
      expect(opened.employee).toBe('Alice')
      expect('salary' in opened).toBe(false)
      expect(JSON.stringify(opened)).not.toContain('5000')
    })
  })

  scenario('A sensitive column in the line items', async ({ admin, createUser }, step) => {
    const PARENT = 'Sales Quote'
    const CHILD = 'Sales Quote Line'
    const quote = tableRef(PARENT)
    let user!: TestClient
    let form!: Row
    let saved!: Row
    await step('a quote "Q-1" with a line "Bolt" whose unit cost is 4200, a sensitive column', async () => {
      await admin.post('/api/table_def', {
        name: CHILD, kind: 'sub_table',
        columns: [
          { column_name: 'item', column_type: 'Data' },
          { column_name: 'unit_cost', column_type: 'Currency', tier: 'restricted' },
        ],
      })
      await admin.post('/api/table_def', {
        name: PARENT, id_pattern: 'prompt',
        columns: [{ column_name: 'customer', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: CHILD }],
      })
      await admin.post('/api/save_row', { table: PARENT, row: { row_id: 'Q-1', customer: 'Acme', lines: [{ item: 'Bolt', unit_cost: 4200 }] } })
    })
    await step('the user does not have the deeper access the unit cost requires', async () => {
      user = await createUserWithRole(admin, createUser, { role: 'Quote Seller', table: PARENT, tier: 'basic', can_read: true, can_write: true, can_create: true })
    })
    await step('the user opens "Q-1", renames the line to "Bolt M8" and saves', async () => {
      form = await user.get<Row>(quote.rowUrl('Q-1'))
      saved = await patchDoc<Row>(user, quote.rowUrl('Q-1'), {
        updated_at: form.updated_at,
        lines: [{ ...form.lines[0], item: 'Bolt M8' }],
      })
    })
    await step('no line shows the unit cost in the form', async () => {
      expect(form.lines).toHaveLength(1)
      for (const line of form.lines as Row[]) expect('unit_cost' in line).toBe(false)
      expect(JSON.stringify(form)).not.toContain('4200')
    })
    await step('no line shows the unit cost in the saved reply', async () => {
      expect(saved.lines).toHaveLength(1)
      expect(saved.lines[0].item).toBe('Bolt M8')
      for (const line of saved.lines as Row[]) expect('unit_cost' in line).toBe(false)
      expect(JSON.stringify(saved)).not.toContain('4200')
    })
    await step('no line shows the unit cost in print', async () => {
      const html = await renderPrintHtml(PARENT, 'Q-1', user.user!)
      expect(html).toContain('Bolt M8')
      expect(html).not.toContain('4200')
    })
    await step('the stored unit cost is still 4200', async () => {
      const stored = await admin.get<Row>(quote.rowUrl('Q-1'))
      expect(stored.lines.map((line: Row) => [line.item, Number(line.unit_cost)])).toEqual([['Bolt M8', 4200]])
    })
  })

  scenario('A System Manager opens a person', async ({ admin, createUser }, step) => {
    let asha = ''
    let stored = ''
    let manager!: TestClient
    let opened!: Row
    let listed!: unknown
    await step('a person "Asha" who has a password', async () => {
      const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Asha', email: 'asha@example.com' } })
      asha = saved.row_id
      await setUserPassword(asha, 'hunter2-secret')
      const [{ password_hash }] = await sql`select password_hash from person where row_id = ${asha}`
      stored = String(password_hash)
      expect(stored).not.toBe('')
    })
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user opens "Asha" and lists people', async () => {
      opened = await manager.get<Row>(PERSON.rowUrl(asha))
      listed = await manager.get(`${PERSON.url}?limit_page_length=500`)
    })
    await step('no password appears', async () => {
      expect(opened.full_name).toBe('Asha')
      expect(opened).not.toHaveProperty('password_hash')
      expect(JSON.stringify(opened)).not.toContain(stored)
      expect(JSON.stringify(listed)).toContain(asha)
      expect(JSON.stringify(listed)).not.toContain(stored)
    })
    await step('asking the list for the password is refused', async () => {
      await expectRefused(manager.get(`${PERSON.url}?fields=${enc('["row_id","password_hash"]')}`), 417)
      await expectRefused(manager.get(`${PERSON.url}?filters=${enc('[["password_hash","is","set"]]')}`), 417)
    })
  })

  scenario('A connected table with a password column', async ({ createUser }, step) => {
    const SCHEMA = 'perm_scenario_tenant'
    const ENV_NAME = 'PERM_SCENARIO_TENANT_URL'
    const BOUND = 'Perm Tenant'
    let manager!: TestClient
    let reflected!: { created: { name: string }[]; skipped: { reason: string }[] }
    await step('another database with a table "tenant" that has a "password" column', async () => {
      const outside = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
      onTestFinished(async () => {
        invalidateSources()
        await outside.unsafe(`drop schema if exists ${SCHEMA} cascade`)
        await outside.end({ timeout: 2 })
      })
      await outside.unsafe(`drop schema if exists ${SCHEMA} cascade`)
      await outside.unsafe(`create schema ${SCHEMA}`)
      await outside.unsafe(`create table ${SCHEMA}.tenant (id text primary key, name text, password text)`)
      await outside.unsafe(`insert into ${SCHEMA}.tenant values ('T-1', 'Acme', 'sk-tenant-secret')`)
      process.env[ENV_NAME] = EXTERNAL_DATABASE_URL
      onTestFinished(() => void delete process.env[ENV_NAME])
    })
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user connects "tenant"', async () => {
      invalidateSources()
      await manager.post('/api/table/Data%20Source', { row_id: 'perm-tenant', engine: 'postgres', url_env: ENV_NAME, default_schema: SCHEMA, access: 'read_write' })
      reflected = await manager.post('/api/table/Data%20Source/perm-tenant:reflect', { schema: SCHEMA, tables: ['tenant'], prefix: 'Perm' })
      expect(reflected.skipped).toEqual([])
      expect(reflected.created.map((table) => table.name)).toEqual([BOUND])
    })
    await step('the "password" column is left out of the connected table', async () => {
      const meta = await manager.get<{ columns: { column_name: string }[] }>(`/api/table/${enc(BOUND)}:meta`)
      expect(meta.columns.map((column) => column.column_name)).toContain('name')
      expect(meta.columns.map((column) => column.column_name)).not.toContain('password')
      expect(JSON.stringify(await manager.get(`/api/table/${enc(BOUND)}/T-1`))).not.toContain('sk-tenant-secret')
    })
    await step('asking for the "password" column is refused', async () => {
      await expectRefused(manager.get(`/api/table/${enc(BOUND)}?fields=${enc('["password"]')}`), 417)
    })
  })

  scenario('An administrator tries to add a sign-in', async ({ createUser }, step) => {
    const ACTIVITY = 'Activity Log'
    const REFUSED = { status: 403, type: 'PermissionError', message: expect.stringMatching(/written only by the platform/) }
    const count = async () => Number((await sql`select count(*)::int as n from activity_log`)[0].n)
    let manager!: TestClient
    let before = 0
    let viaRow!: Response
    let viaSave!: Response
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user tries to add a sign-in to the activity record', async () => {
      before = await count()
      viaRow = await manager.fetch(`/api/table/${enc(ACTIVITY)}`, { method: 'POST', body: JSON.stringify({ user: 'Administrator', operation: 'login' }) })
      viaSave = await manager.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: ACTIVITY, row: { user: 'Administrator', operation: 'login' } }) })
    })
    await step('it is refused', async () => {
      await expectApiError(viaRow, REFUSED)
      await expectApiError(viaSave, REFUSED)
    })
    await step('the activity record is unchanged', async () => {
      expect(await count()).toBe(before)
    })
  })

  scenario('A look-alike table reaches nothing', async ({ createUser }, step) => {
    let manager!: TestClient
    let attempt!: Response
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user creates a table named "ACTIVITY  LOG"', async () => {
      attempt = await manager.fetch('/api/table_def', {
        method: 'POST',
        body: JSON.stringify({ name: 'ACTIVITY  LOG', columns: [{ column_name: 'note', column_type: 'Data' }] }),
      })
    })
    await step('it is refused, because two tables can never share the same storage', async () => {
      await expectApiError(attempt, { status: 409, type: 'ConflictError', message: expect.stringMatching(/collides with an internal table/), fields: { name: expect.stringMatching(/reserved for platform storage/) } })
      expect(await sql`select name from table_def where lower(name) = 'activity  log'`).toEqual([])
    })
  })

  scenario('An export is recorded', async ({ admin, api, createUser }, step) => {
    let exporter = ''
    let viewer!: TestClient
    let token = ''
    await step('the user can read people', async () => {
      const saved = await admin.post<{ row_id: string }>('/api/save_row', {
        table: 'Person', row: { email: 'exporter@x.com', enabled: true, roles: [{ role: 'System Manager' }] },
      })
      exporter = saved.row_id
      await setUserPassword(exporter, 'exportpw12345')
      const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'exporter@x.com', pwd: 'exportpw12345' }) })
      await expectStatus(login, 200)
      token = ((await login.json()) as { token: string }).token
    })
    await step('the user exports a list of people as a spreadsheet file', async () => {
      const res = await api.fetch('/api/access_log', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ table: 'Person', method: 'csv' }),
      })
      await expectStatus(res, 200)
    })
    await step('a System Manager can see afterward that the user exported people', async () => {
      viewer = await createUser({ roles: ['System Manager'] })
      const seen = await viewer.get<{ data: Row[] }>(
        `/api/table/${enc('Access Log')}?fields=${enc(JSON.stringify(['user', 'operation', 'ref_table', 'method']))}`,
      )
      expect(seen.data).toContainEqual(expect.objectContaining({ user: exporter, operation: 'export', ref_table: 'Person' }))
    })
    await step('in which format', async () => {
      const seen = await viewer.get<{ data: Row[] }>(
        `/api/table/${enc('Access Log')}?fields=${enc(JSON.stringify(['user', 'operation', 'ref_table', 'method']))}`,
      )
      expect(seen.data).toContainEqual({ user: exporter, operation: 'export', ref_table: 'Person', method: 'csv' })
    })
  })

  scenario('A print is recorded', async ({ admin, createUser }, step) => {
    let user!: TestClient
    let printed!: Response
    await step('the user can read the row "P-1" of a table "Print Doc"', async () => {
      const doc = await makeTable(admin, { name: 'Print Doc', id_pattern: 'prompt', columns: ['customer'] })
      await admin.post(doc.url, { row_id: 'P-1', customer: 'Umbrella Corp' })
      user = await createUserWithRole(admin, createUser, { role: 'Print Reader', table: 'Print Doc', can_read: true })
      await expectStatus(await user.fetch(doc.rowUrl('P-1')), 200)
      expect(await sql`select 1 from access_log where ref_table = 'Print Doc'`).toHaveLength(0)
    })
    await step('the user prints "P-1" as a PDF', async () => {
      printed = await user.fetch(`/api/print/${enc('Print Doc')}/P-1`)
      await expectStatus(printed, 200)
      expect(printed.headers.get('content-type')).toBe('application/pdf')
    })
    await step('the record names the user, the table "Print Doc", the row "P-1" and the PDF format', async () => {
      const logged = await sql`
        select "user", operation, ref_table, reference_name, method from access_log
        where ref_table = 'Print Doc' and operation = 'print'`
      expect(logged).toEqual([{ user: user.user, operation: 'print', ref_table: 'Print Doc', reference_name: 'P-1', method: 'pdf' }])
    })
  }, 30_000)

  /** A user who may edit people but is not a System Manager. */
  const personEditor = (admin: TestClient, createUser: Parameters<typeof createUserWithRole>[1]) =>
    createUserWithRole(admin, createUser, { role: 'Person Editor', table: 'Person', ...ALL_ACTIONS })

  scenario('A grant on the permission table does not let a user write it', async ({ admin, createUser }, step) => {
    let user!: TestClient
    let before = 0
    let attempt!: Response
    await step('the user\'s role is granted full access to the permission table', async () => {
      user = await createUserWithRole(admin, createUser, { role: 'Permission Writer', table: 'Permission', ...ALL_ACTIONS })
      before = (await sql`select count(*)::int as n from permission`)[0].n
    })
    await step('the user tries to add a permission row', async () => {
      attempt = await user.fetch('/api/save_row', {
        method: 'POST',
        body: JSON.stringify({ table: 'Permission', row: { ref_table: 'Person', role: 'Permission Writer', operation: 'read' } }),
      })
    })
    await step('the save is refused', async () => {
      await expectRefused(attempt, 403)
      expect((await sql`select count(*)::int as n from permission`)[0].n).toBe(before)
    })
  })

  scenario('Editing people does not include their roles', async ({ admin, createUser }, step) => {
    let editor!: TestClient
    let asha = ''
    let attempt!: Response
    await step('the user may edit people but is not a System Manager', async () => {
      editor = await personEditor(admin, createUser)
    })
    await step('a person "Asha" holds no roles', async () => {
      asha = await makePerson({ full_name: 'Asha' })
      expect((await personRow(admin, asha)).roles).toEqual([])
    })
    await step('the user tries to give "Asha" a role', async () => {
      const row = await personRow(admin, asha)
      attempt = await editor.fetch(PERSON.rowUrl(asha), { method: 'PATCH', body: JSON.stringify({ updated_at: row.updated_at, roles: [{ role: 'System Manager' }] }) })
    })
    await step('the save is refused', async () => {
      await expectRefused(attempt, 403)
    })
    await step('"Asha" is unchanged', async () => {
      const after = await personRow(admin, asha)
      expect(after.roles).toEqual([])
      expect(after.full_name).toBe('Asha')
    })
  })

  scenario('A save script cannot slip a role in', async ({ admin, createUser }, step) => {
    let editor!: TestClient
    let asha = ''
    let attempt!: Response
    await step('the user may edit people but is not a System Manager', async () => {
      editor = await personEditor(admin, createUser)
      asha = await makePerson({ full_name: 'Asha' })
    })
    await step('a script that runs on every person save adds a role', async () => {
      await admin.post('/api/save_row', {
        table: 'Server Script',
        row: { row_id: 'ss-adds-role', script_type: 'Document Event', ref_table: 'Person', event: 'before_save', script: 'doc.roles = [{ role: "System Manager" }]', enabled: true },
      })
    })
    await step('the user saves the name of a person "Asha"', async () => {
      const row = await personRow(admin, asha)
      attempt = await editor.fetch(PERSON.rowUrl(asha), { method: 'PATCH', body: JSON.stringify({ updated_at: row.updated_at, full_name: 'Asha Rao' }) })
    })
    await step('the save is refused', async () => {
      await expectRefused(attempt, 403)
      const after = await personRow(admin, asha)
      expect(after.roles).toEqual([])
      expect(after.full_name).toBe('Asha')
    })
  })

  scenario('A workflow cannot switch accounts off', async ({ createUser }, step) => {
    let manager!: TestClient
    let attempt!: Response
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user saves a workflow whose state is a person\'s enabled flag', async () => {
      attempt = await manager.fetch('/api/save_row', {
        method: 'POST',
        body: JSON.stringify({
          table: 'Workflow',
          row: {
            row_id: 'Wf switch off', ref_table: 'Person', state_field: 'enabled', is_active: false,
            states: [{ state: 'true', target_status: 'draft' }, { state: 'false', target_status: 'draft' }],
            transitions: [{ state: 'true', action: 'Disable', next_state: 'false', allowed: 'System Manager' }],
          },
        }),
      })
    })
    await step('the save is refused', async () => {
      await expectApiError(attempt, { status: 417, message: expect.stringMatching(/decides who can do what/) })
      expect(await sql`select 1 from workflow where row_id = 'Wf switch off'`).toHaveLength(0)
    })
  })

  scenario('An ordinary edit still saves', async ({ admin, createUser }, step) => {
    let editor!: TestClient
    let asha = ''
    let saved!: Row
    await step('the user may edit people but is not a System Manager', async () => {
      editor = await personEditor(admin, createUser)
    })
    await step('the user changes the name of a person "Asha" and the form sends back the same roles and enabled flag', async () => {
      asha = await makePerson({ full_name: 'Asha', roles: [{ role: 'Person Editor' }] })
      const row = await personRow(admin, asha)
      saved = await patchDoc<Row>(editor, PERSON.rowUrl(asha), { updated_at: row.updated_at, full_name: 'Asha Rao', enabled: true, roles: row.roles })
    })
    await step('the edit saves', async () => {
      expect(saved.full_name).toBe('Asha Rao')
      const after = await personRow(admin, asha)
      expect(after.full_name).toBe('Asha Rao')
      expect(after.enabled).toBe(true)
      expect(after.roles.map((role) => role.role)).toEqual(['Person Editor'])
    })
  })

  scenario("Reusing a role row's id does not remove a role", async ({ admin, createUser }, step) => {
    let editor!: TestClient
    let asha = ''
    let doc!: Awaited<ReturnType<typeof personRow>>
    let attempt!: Response
    await step('the user may edit people but is not a System Manager', async () => {
      editor = await personEditor(admin, createUser)
    })
    await step('a person "Asha" holds two roles', async () => {
      await grantRole(admin, { role: 'Second Role', table: [] })
      asha = await makePerson({ full_name: 'Asha', roles: [{ role: 'System Manager' }, { role: 'Second Role' }] })
      doc = await personRow(admin, asha)
      expect(doc.roles).toHaveLength(2)
    })
    await step('the user saves "Asha" with both role values under one of the two row ids', async () => {
      const [a, b] = doc.roles
      attempt = await editor.fetch(PERSON.rowUrl(asha), {
        method: 'PATCH',
        body: JSON.stringify({ updated_at: doc.updated_at, roles: [{ row_id: b.row_id, role: a.role }, { row_id: b.row_id, role: b.role }] }),
      })
    })
    await step('the save is refused', async () => {
      await expectApiError(attempt, { status: 417 })
    })
    await step('"Asha" keeps both roles', async () => {
      const [a, b] = doc.roles
      expect((await personRow(admin, asha)).roles.map((role) => role.role).sort()).toEqual([a.role, b.role].sort())
    })
  })

  // The release runs as production would: its own secret, an instance address,
  // and no mock Google provider (which this suite turns on for itself).
  function asProductionRelease() {
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    const before = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses('[{"address":"https://featherbase.example.test","opens":"admin","emails":true}]', 'production')
    onTestFinished(() => {
      config.instanceAddresses = before
      vi.unstubAllEnvs()
    })
  }
  const outcomeOf = (run: Promise<unknown>) => run.then(() => null, (err: Error) => err)

  scenario('Everyone can read people', async ({}, step) => {
    let outcome: Error | null = null
    await step('every signed-in user is granted read on people', async () => {
      asProductionRelease()
      await sql`insert into permission ${sql({ row_id: 'everyone-reads-people', ref_table: 'Person', role: 'All', operation: 'read', scope_mode: 'all', created_by: 'Administrator', updated_by: 'Administrator' })}`
    })
    await step('a release runs against that database', async () => {
      outcome = await outcomeOf(preflightRelease({ environment: 'test' }))
    })
    await step('the release stops, naming that permission row', async () => {
      expect(outcome, 'the release should have stopped').not.toBeNull()
      expect(outcome!.message).toMatch(/Permission everyone-reads-people grants role "All" on "Person" \(read\)/)
    })
  })

  scenario('Open sign-up in production', async ({}, step) => {
    let outcome: Error | null = null
    await step('password sign-in is set to create new people', async () => {
      asProductionRelease()
      vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
      await sql`update sign_in_method set new_person = 'create' where kind = 'password'`
    })
    await step('a production release runs', async () => {
      outcome = await outcomeOf(preflightRelease({ environment: 'production' }))
    })
    await step('the release stops and says to set it to refuse', async () => {
      expect(outcome, 'the release should have stopped').not.toBeNull()
      expect(outcome!.message).toMatch(/password sign-in method "password" creates a new person for anyone it admits, on a "production" server: set its new_person to refuse/)
    })
  })

  scenario('A manager who also reads an instance table', async ({ admin, createUser }, step) => {
    let manager!: TestClient
    let caps!: Caps
    await step("a store manager whose only grant is to read Dash's own tables", async () => {
      expect(await discoverPackages([DASH_STAND_IN])).toEqual([])
      await admin.post('/api/install_app', { name: 'dash' })
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: DASH_ROLE } })
      await grantRole(admin, { table: APP_TABLE, role: DASH_ROLE, can_read: true })
      manager = await createUser({ email: 'scn.manager.both@example.com', roles: [DASH_ROLE] })
    })
    await step("the user is also given a grant to read one of the instance's own tables", async () => {
      await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
      await grantRole(admin, { table: 'Back Office', role: 'Office Clerk', can_read: true })
      const person = await admin.get<{ updated_at: string; roles: { role: string }[] }>(`/api/table/Person/${encodeURIComponent(manager.user!)}`)
      await admin.post('/api/save_row', {
        table: 'Person',
        row: { row_id: manager.user, updated_at: person.updated_at, roles: [...person.roles, { role: 'Office Clerk' }] },
      })
    })
    await step('the user opens the administration', async () => {
      caps = await capsOf(manager)
    })
    await step('it opens', async () => {
      expect(caps.admin).toBe(true)
      expect(await manager.post('/api/open_admin', {})).toBeTruthy()
    })
    await step("Dash's tables are listed beside that one", async () => {
      expect(caps.tables).toEqual(expect.arrayContaining(['Back Office', APP_TABLE]))
    })
  })

  scenario('A clerk of an app without pages of its own', async ({ admin, createUser }, step) => {
    let clerk!: TestClient
    let caps!: Caps
    await step('an installed app that has no pages of its own', async () => {
      expect(await discoverPackages([EVOLVE])).toEqual([])
      await admin.post('/api/install_app', { name: 'evolve' })
    })
    await step("a clerk whose only grant is on that app's tables", async () => {
      clerk = await createUser({ email: 'scn.evolve.clerk@example.com', roles: ['Evolve Clerk'] })
    })
    await step('the user signs in', async () => {
      caps = await capsOf(clerk)
    })
    await step('the user can open the administration', async () => {
      expect(caps.admin).toBe(true)
    })
    await step("the user can use that app's tables there", async () => {
      const saved = await clerk.post<{ row_id: string }>('/api/save_row', { table: 'evolve.item', row: { row_id: 'it-1', title: 'Shelf' } })
      expect(saved.row_id).toBe('it-1')
    })
  })

  scenario('Create without edit', async ({ admin, createUser }, step) => {
    const orders = tableRef('Cog Order')
    let planner!: TestClient
    let savedId = ''
    await step("the user's role may create orders but not edit them", async () => {
      await admin.post('/api/table_def', { name: 'Cog Order', columns: [{ column_name: 'title', column_type: 'Data' }] })
      planner = await createUserWithRole(admin, createUser, { role: 'Cog Planner', table: 'Cog Order', tier: 'basic', can_read: true, can_create: true })
    })
    await step('the user saves a new order titled "Planner order"', async () => {
      savedId = (await planner.post<{ row_id: string }>('/api/save_row', { table: 'Cog Order', row: { title: 'Planner order' } })).row_id
    })
    await step('the order is saved with that title', async () => {
      expect((await admin.get<{ title: string }>(orders.rowUrl(savedId))).title).toBe('Planner order')
    })
    await step('a later change to it is refused', async () => {
      const stored = await admin.get<{ updated_at: string }>(orders.rowUrl(savedId))
      await expect(patchDoc(planner, orders.rowUrl(savedId), { updated_at: stored.updated_at, title: 'Changed' })).rejects.toMatchObject({ status: 403 })
      expect((await admin.get<{ title: string }>(orders.rowUrl(savedId))).title).toBe('Planner order')
    })
  })

  scenario('A person with only their creation entry can still be deleted', async ({ admin }, step) => {
    let personId = ''
    await step('a person created with the role "Rh Clerk", and not changed since', async () => {
      await saveDoc('Role', { row_id: 'Rh Clerk' }, 'Administrator', 'insert')
      const p = await admin.post<{ row_id: string }>('/api/save_row', {
        table: 'Person',
        row: { enabled: true, email: 'scn.rh.leaving@example.com', full_name: 'Rh Leaving', roles: [{ role: 'Rh Clerk' }] },
      })
      personId = p.row_id
      expect(await sql`select 1 from has_role where parent = ${personId}`).toHaveLength(1)
    })
    await step('the person is deleted', async () => {
      await admin.delete(`/api/table/Person/${encodeURIComponent(personId)}`)
    })
    await step('the person and their roles are removed', async () => {
      expect(await sql`select 1 from person where row_id = ${personId}`).toHaveLength(0)
      expect(await sql`select 1 from has_role where parent = ${personId}`).toHaveLength(0)
    })
    await step('no history is left behind', async () => {
      expect(await sql`select 1 from version where ref_table = 'Person' and ref_name = ${personId}`).toHaveLength(0)
    })
  })

  scenario('A newcomer holds the role everyone holds', async ({ admin, createUser }, step) => {
    let newcomer!: TestClient
    await step('System Settings gives "Tasker Member" to everyone who signs in', async () => {
      await memberRole(admin)
      await setEveryone(admin, MEMBER)
    })
    await step('a person with no roles of their own signs in', async () => {
      newcomer = await createUser({})
    })
    await step('they can do what Tasker Member may do', async () => {
      await expectStatus(await newcomer.fetch(notes), 200)
    })
  })

  scenario('Someone who signs in later holds it too, and a service account does not', async ({ admin, createUser }, step) => {
    let later!: TestClient
    await step('System Settings names "Tasker Member" for everyone who signs in', async () => {
      await memberRole(admin)
      await setEveryone(admin, MEMBER)
    })
    await step('a person signs in for the first time', async () => {
      later = await createUser({})
    })
    await step('they hold Tasker Member', async () => {
      expect(await getRoles(String(later.user))).toContain(MEMBER)
    })
    await step("a service account still doesn't", async () => {
      await grantRole(admin, { role: 'Er Robot', table: NOTES, can_read: true })
      const robot = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-er-robot', roles: ['Er Robot'] })
      expect(await getRoles(robot.row_id)).not.toContain(MEMBER)
    })
  })

  scenario('Removing the role takes it only from those who held it that way', async ({ admin, createUser }, step) => {
    let viaSetting!: TestClient
    let direct!: TestClient
    await step('System Settings gives "Tasker Member" to everyone who signs in', async () => {
      await memberRole(admin)
      await setEveryone(admin, MEMBER)
    })
    await step('one person holds it only through the setting, and another was given it directly', async () => {
      viaSetting = await createUser({})
      direct = await createUser({ roles: [MEMBER] })
      await expectStatus(await viaSetting.fetch(notes), 200)
      await expectStatus(await direct.fetch(notes), 200)
    })
    await step('"Tasker Member" is removed from the setting', async () => {
      await setEveryone(admin, null)
    })
    await step('the first no longer holds it', async () => {
      expect(await getRoles(String(viaSetting.user))).not.toContain(MEMBER)
      await expectStatus(await viaSetting.fetch(notes), 403)
    })
    await step('the second still does', async () => {
      expect(await getRoles(String(direct.user))).toContain(MEMBER)
      await expectStatus(await direct.fetch(notes), 200)
    })
  })

  scenario('A platform role cannot be given to everyone', async ({ admin, createUser }, step) => {
    let manager!: TestClient
    let outcome!: Promise<unknown>
    await step('the user is a System Manager', async () => {
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('the user names System Manager in the setting', async () => {
      outcome = setEveryone(manager, 'System Manager')
      await outcome.catch(() => undefined)
    })
    await step('the save is refused with "System Manager cannot be given to everyone"', async () => {
      await expect(outcome).rejects.toMatchObject({ status: 417, fields: { everyone_roles: 'System Manager cannot be given to everyone' } })
      expect((await settings(admin)).everyone_roles ?? '').not.toContain('System Manager')
    })
  })

  scenario('A supplier store does not hide a row', async ({ admin, createUser }, step) => {
    let world!: World
    let seen: Awaited<ReturnType<typeof listed>> = []
    let section!: TableRef
    await step('a sections table narrowed by its store alone', async () => {
      section = await sectionsTable(admin, { scope_on: ['store'] })
    })
    await step('the user is narrowed to the North store', async () => {
      world = await storeManager(admin, createUser, section, [{ allow_table: STORE, for_value: 'North' }])
    })
    await step('the user opens the sections table', async () => {
      seen = await listed(world.user, world.section)
    })
    await step("the user sees North's sections, including one whose supplier store is South", async () => {
      const north = seen.filter((r) => r.store === 'North')
      expect(north.map((r) => r.title)).toEqual(['n'])
      expect(north[0].supplier_store).toBe('South')
      expect(seen.map((r) => r.title)).not.toContain('s')
    })
  })

  scenario('A store manager whose scope never arrived', async ({ admin, createUser }, step) => {
    let world!: World
    let res!: { data: unknown[]; total: number }
    let section!: TableRef
    await step('a sections table that requires narrowing', async () => {
      section = await sectionsTable(admin, { scope_on: ['store'], scope_required: true })
    })
    await step('a store manager with no narrowing at all', async () => {
      world = await storeManager(admin, createUser, section, [])
      expect(await sql`select 1 from data_scope where person = ${world.user.user!}`).toHaveLength(0)
    })
    await step('the user opens the sections table', async () => {
      res = await world.user.get(world.section.url)
    })
    await step('the list is empty', async () => {
      expect(res.total).toBe(0)
      expect(res.data).toEqual([])
      expect((await world.user.get<{ count: number }>(`/api/table/${encodeURIComponent(SECTION)}:count`)).count).toBe(0)
    })
    await step('opening, adding or changing a section is refused', async () => {
      const { user, section, rowOf } = world
      const n = await rowOf('n')
      await expectRefused(user.get(section.rowUrl(n)), 403)
      await expectRefused(user.get(section.rowUrl(await rowOf('none'))), 403)
      await expectRefused(user.post(section.url, { title: 'x', store: 'North' }), 403)
      await expectRefused(user.post(section.url, { title: 'x' }), 403)
      const [current] = await sql.unsafe(`select updated_at from featherbase.sr_section where row_id = $1`, [n])
      await expectRefused(user.fetch(section.rowUrl(n), { method: 'PATCH', body: JSON.stringify({ title: 'changed', updated_at: current.updated_at }) }), 403)
      const [still] = await sql.unsafe(`select title from featherbase.sr_section where row_id = $1`, [n])
      expect(still.title).toBe('n')
    })
  })

  scenario('A section that names no store', async ({ admin, createUser }, step) => {
    let world!: World
    let titles: string[] = []
    let section!: TableRef
    await step('a sections table that requires narrowing', async () => {
      section = await sectionsTable(admin, { scope_on: ['store'], scope_required: true })
    })
    await step('a store manager narrowed to the North store', async () => {
      world = await storeManager(admin, createUser, section, [{ allow_table: STORE, for_value: 'North' }])
    })
    await step('the user opens the sections table', async () => {
      titles = (await listed(world.user, world.section)).map((r) => r.title)
    })
    await step("the user sees North's sections", async () => {
      expect(titles).toContain('n')
    })
    await step('not one that names no store', async () => {
      expect(titles).toEqual(['n'])
    })
  })

  scenario('A grant that was edited', async ({ admin, createUser }, step) => {
    let grantId = ''
    let holder!: TestClient
    let manager!: TestClient
    await step("a role's read grant on a table, edited before", async () => {
      grantId = await editedReadGrant(admin)
      expect((await historyOf(admin, grantId)).length).toBeGreaterThanOrEqual(2)
    })
    await step('a person holding that role', async () => {
      holder = await createUser({ roles: [UT_ROLE] })
      await expectStatus(await holder.fetch(utList), 200)
    })
    await step('a System Manager unticks read for the role', async () => {
      manager = await createUser({ roles: ['System Manager'] })
      await expectStatus(await untickRead(manager), 200)
    })
    await step('the person is refused the table on their next request', async () => {
      await expectStatus(await holder.fetch(utList), 403)
    })
    await step("the grant's history can still be read, ending with who took it away and what it was", async () => {
      const last = (await historyOf(admin, grantId)).at(-1)!
      expect(last.created_by).toBe(String(manager.user))
      expect(last.data.changed).toEqual(expect.arrayContaining([
        ['ref_table', DT, null], ['role', UT_ROLE, null], ['operation', 'read', null],
      ]))
    })
  })

  scenario('Deleting the same grant any other way', async ({ admin, createUser }, step) => {
    let grantId = ''
    let manager!: TestClient
    let refused!: Response
    await step("a role's read grant on a table, edited before", async () => {
      grantId = await editedReadGrant(admin)
      manager = await createUser({ roles: ['System Manager'] })
    })
    await step('a System Manager deletes that grant from its own row instead', async () => {
      refused = await manager.fetch(`/api/table/Permission/${grantId}`, { method: 'DELETE' })
    })
    await step('the delete is refused and the grant stays', async () => {
      await expectStatus(refused, 417)
      expect(await refused.text()).toContain('history entries')
      expect(await sql`select 1 from permission where row_id = ${grantId}`).toHaveLength(1)
    })
  })
})
