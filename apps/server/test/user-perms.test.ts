import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, grantRole, makeTable, type TableRef } from './fixtures'
import { sql } from '../src/db'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const COMPANY = 'Up Company'
const PROJECT = 'Up Project'
const ROLE = 'Up Role'

// Per-test world: both Tables, the role + grants, two companies, two
// projects, and a user restricted to Company A — all rolled back afterwards.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ user: TestClient; company: TableRef; project: TableRef }> {
  const company = await makeTable(admin, {
    name: COMPANY,
    id_pattern: 'prompt',
    columns: ['country'],
  })
  const project = await makeTable(admin, {
    name: PROJECT,
    columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }],
  })
  const user = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: [PROJECT, COMPANY],
    can_read: true,
    can_write: true,
    can_create: true,
  })
  for (const c of ['Company A', 'Company B'])
    await admin.post('/api/save_row', { table: COMPANY, row: { row_id: c } })
  for (const [t, c] of [['pa', 'Company A'], ['pb', 'Company B']])
    await admin.post('/api/save_row', { table: PROJECT, row: { title: t, company: c } })
  // Restrict the user to Company A
  await admin.post('/api/save_row', {
    table: 'Data Scope',
    row: { person: user.user, allow_table: COMPANY, for_value: 'Company A' },
  })
  return { user, company, project }
}

describe('PERM-005: Data Scopes', () => {
  test('direct reads of non-permitted docs are 403 (linked and target)', async ({
    admin,
    createUser,
  }) => {
    const { user, company, project } = await setup(admin, createUser)
    const pb = await sql.unsafe(`select row_id from featherbase.up_project where title='pb'`)
    await expectRefused(user.get(project.rowUrl(String(pb[0].row_id))), 403)
    await expectRefused(user.get(company.rowUrl('Company B')), 403)
    await expectStatus(await user.fetch(company.rowUrl('Company A')), 200)
  })

  test('creating/updating docs pointing at non-permitted values is rejected', async ({
    admin,
    createUser,
  }) => {
    const { user, project } = await setup(admin, createUser)
    await expectApiError(user.post(project.url, { title: 'nope', company: 'Company B' }), {
      status: 403,
    })
    const ok = await user.fetch(project.url, {
      method: 'POST',
      body: JSON.stringify({ title: 'fine', company: 'Company A' }),
    })
    await expectStatus(ok, 201)
  })

  // #1223: a row they may edit can't be edited OUT of their scope, into a value they can't reach
  // (a store manager moving their store's section into another store). Only the row as loaded was judged.
  test('updating a permitted row to a non-permitted value is rejected, and the row is unchanged', async ({
    admin,
    createUser,
  }) => {
    const { user } = await setup(admin, createUser)
    const [pa] = await sql.unsafe(`select row_id, updated_at from featherbase.up_project where title='pa'`)
    await expectApiError(user.post('/api/save_row', { table: PROJECT, row: { row_id: pa.row_id, updated_at: pa.updated_at, company: 'Company B' } }), {
      status: 403,
    })
    const [after] = await sql.unsafe(`select company from featherbase.up_project where row_id = '${String(pa.row_id)}'`)
    expect(after.company).toBe('Company A')
    // Within scope still saves.
    const ok = await user.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: PROJECT, row: { row_id: pa.row_id, updated_at: pa.updated_at, title: 'pa renamed' } }) })
    await expectStatus(ok, 201)
  })

  // #1223: an insert is judged as written, after defaults: a default can't land a row outside the scope.
  test('a default naming a non-permitted value is refused on insert, and nothing is saved', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await makeTable(admin, { name: 'Up Ticket', columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY, default_value: 'Company B' }] })
    await grantRole(admin, { role: ROLE, table: 'Up Ticket', can_read: true, can_create: true, can_write: true })
    await expectApiError(user.post('/api/save_row', { table: 'Up Ticket', row: { title: 'defaulted' } }), { status: 403 })
    expect(await sql.unsafe(`select 1 from featherbase.up_ticket where title = 'defaulted'`)).toHaveLength(0)
    await expectStatus(await user.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Up Ticket', row: { title: 'named', company: 'Company A' } }) }), 201)
  })

  // #1223: each child row is judged too: a row inside the scope can't hold a line naming a value outside it.
  test('a Sub-table row naming a non-permitted value is refused, on insert and on update', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await makeTable(admin, { name: 'Up Line', kind: 'sub_table', columns: ['note', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }] })
    await makeTable(admin, { name: 'Up Plan', columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Up Line' }] })
    await grantRole(admin, { role: ROLE, table: ['Up Plan', 'Up Line'], can_read: true, can_create: true, can_write: true })
    await expectApiError(user.post('/api/save_row', { table: 'Up Plan', row: { title: 'p1', company: 'Company A', lines: [{ note: 'x', company: 'Company B' }] } }), { status: 403 })
    expect(await sql.unsafe(`select 1 from featherbase.up_plan where title = 'p1'`)).toHaveLength(0)
    const plan = await user.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'Up Plan', row: { title: 'p2', company: 'Company A', lines: [{ note: 'ok', company: 'Company A' }] } })
    const [line] = await sql.unsafe(`select row_id from featherbase.up_line where parent = '${plan.row_id}'`)
    await expectApiError(user.post('/api/save_row', { table: 'Up Plan', row: { row_id: plan.row_id, updated_at: plan.updated_at, lines: [{ row_id: line.row_id, note: 'ok', company: 'Company B' }] } }), { status: 403 })
    const [after] = await sql.unsafe(`select company from featherbase.up_line where row_id = '${String(line.row_id)}'`)
    expect(after.company).toBe('Company A')
  })

  // #1223 (Codex round 2): a Data Scope on the child Table itself names the rows allowed; a new child is none of them.
  test('a new Sub-table row is refused when the child Table is scoped to other rows', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await makeTable(admin, { name: 'Up Note', kind: 'sub_table', columns: ['note'] })
    await makeTable(admin, { name: 'Up Board', columns: ['title', { column_name: 'notes', column_type: 'Sub-table', row_table: 'Up Note' }] })
    await grantRole(admin, { role: ROLE, table: ['Up Board', 'Up Note'], can_read: true, can_create: true, can_write: true })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: 'Up Note', for_value: 'only-this-one' } })
    await expectApiError(user.post('/api/save_row', { table: 'Up Board', row: { title: 'b1', notes: [{ note: 'appended' }] } }), { status: 403 })
    expect(await sql.unsafe(`select 1 from featherbase.up_note where note = 'appended'`)).toHaveLength(0)
  })

  // #1223 (Codex round 3): a stored child outside the scope can be neither taken over nor deleted by leaving it out.
  test('a stored Sub-table row outside the scope can be neither reassigned into it nor deleted by omission', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await makeTable(admin, { name: 'Up Line', kind: 'sub_table', columns: ['note', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }] })
    await makeTable(admin, { name: 'Up Plan', columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Up Line' }] })
    await grantRole(admin, { role: ROLE, table: ['Up Plan', 'Up Line'], can_read: true, can_create: true, can_write: true })
    const plan = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'Up Plan', row: { title: 'mixed', company: 'Company A', lines: [{ note: 'b line', company: 'Company B' }] } })
    const [line] = await sql.unsafe(`select row_id from featherbase.up_line where parent = '${plan.row_id}'`)
    await expectApiError(user.post('/api/save_row', { table: 'Up Plan', row: { row_id: plan.row_id, updated_at: plan.updated_at, lines: [{ row_id: line.row_id, note: 'b line', company: 'Company A' }] } }), { status: 403 })
    await expectApiError(user.post('/api/save_row', { table: 'Up Plan', row: { row_id: plan.row_id, updated_at: plan.updated_at, lines: [] } }), { status: 403 })
    const [after] = await sql.unsafe(`select company from featherbase.up_line where row_id = '${String(line.row_id)}'`)
    expect(after.company).toBe('Company B')
  })

  // #1244: a child row is only as visible as its parent, the parent's Data Scope included. A list (and a
  // count) of an unscoped child Table showed the lines of parents outside the viewer's scope.
  test("a Sub-table's rows are listed only under parents inside the viewer's Data Scope", async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    await makeTable(admin, { name: 'Up Note', kind: 'sub_table', columns: ['note'] })
    await makeTable(admin, { name: 'Up Board', columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }, { column_name: 'notes', column_type: 'Sub-table', row_table: 'Up Note' }] })
    await grantRole(admin, { role: ROLE, table: ['Up Board', 'Up Note'], can_read: true })
    await admin.post('/api/save_row', { table: 'Up Board', row: { title: 'north', company: 'Company A', notes: [{ note: 'north line' }] } })
    await admin.post('/api/save_row', { table: 'Up Board', row: { title: 'south', company: 'Company B', notes: [{ note: 'south line' }] } })
    const listed = await user.get<{ data: { note: string }[] }>('/api/table/Up%20Note?fields=%5B%22note%22%5D')
    expect(listed.data.map((r) => r.note)).toEqual(['north line'])
    const [south] = await sql.unsafe(`select row_id from featherbase.up_note where note = 'south line'`)
    await expectRefused(user.get(`/api/table/Up%20Note/${String(south.row_id)}`), 403)
  })

  test('admins are unaffected', async ({ admin, createUser }) => {
    const { project } = await setup(admin, createUser)
    const res = await admin.get<{ total: number }>(project.url)
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})
