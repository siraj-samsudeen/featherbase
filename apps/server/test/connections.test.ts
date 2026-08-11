import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// Relational navigation (#100): GET /api/table/:table/:row_id:connections
// returns every table pointing at the row via Reference columns, with
// permission-scoped counts and ready-to-use ListView filters — including
// the via-sub-table ("internal links") case where the owning table is
// surfaced instead of the child rows.

const EMP = 'Cnx Employee'
const ATT = 'Cnx Attendance'
const LINE = 'Cnx Order Line'
const ORDER = 'Cnx Order'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: EMP,
    id_pattern: 'prompt',
    columns: [{ column_name: 'dept', column_type: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: ATT,
    columns: [
      { column_name: 'employee', column_type: 'Reference', reference_table: EMP },
      { column_name: 'att_status', column_type: 'Data' },
    ],
  })
  await admin.post('/api/doctype', {
    name: LINE,
    kind: 'sub_table',
    columns: [
      { column_name: 'employee', column_type: 'Reference', reference_table: EMP },
      { column_name: 'qty', column_type: 'Int', default_value: '1' },
    ],
  })
  await admin.post('/api/doctype', {
    name: ORDER,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: LINE },
    ],
  })
  await admin.post(`/api/table/${encodeURIComponent(EMP)}`, { row_id: 'E-001' })
  await admin.post(`/api/table/${encodeURIComponent(EMP)}`, { row_id: 'E-002' })
}

type Cnx = {
  table: string
  column: string
  via: string | null
  count: number
  filters: [string, string, unknown][]
}

const getConnections = async (client: TestClient, name: string) => {
  const res = await client.get<{ connections: Cnx[] }>(
    `/api/table/${encodeURIComponent(EMP)}/${encodeURIComponent(name)}:connections`,
  )
  return res.connections.filter((c) => c.table.startsWith('Cnx '))
}

// Evaluate a connection's filters through the ordinary list API — proves the
// filter both round-trips and stays inside the caller's read scope.
const listWith = async (client: TestClient, table: string, filters: unknown[]) => {
  const res = await client.get<{ data: { name: string }[] }>(
    `/api/table/${encodeURIComponent(table)}?filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=500`,
  )
  return res.data.map((r) => r.row_id)
}

describe('NAV-001: row connections', () => {
  test('direct backlinks carry counts and an equals filter', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_doc', {
      doctype: ATT,
      doc: { employee: 'E-001', att_status: 'Present' },
    })
    await admin.post('/api/save_doc', {
      doctype: ATT,
      doc: { employee: 'E-001', att_status: 'Absent' },
    })
    await admin.post('/api/save_doc', {
      doctype: ATT,
      doc: { employee: 'E-002', att_status: 'Present' },
    })

    const cnx = await getConnections(admin, 'E-001')
    const att = cnx.find((c) => c.table === ATT)
    expect(att).toMatchObject({
      column: 'employee',
      via: null,
      count: 2,
      filters: [['employee', '=', 'E-001']],
    })
  })

  test('via-sub-table backlinks surface the owning table with a related filter', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-1', title: 'one', lines: [{ employee: 'E-001' }, { employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-2', title: 'two', lines: [{ employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-3', title: 'three', lines: [{ employee: 'E-002' }] },
    })

    const cnx = await getConnections(admin, 'E-001')
    const ord = cnx.find((c) => c.table === ORDER)
    expect(ord).toBeDefined()
    expect(ord).toMatchObject({ column: 'employee', via: LINE, count: 2 })
    // NAV-002: a compact relationship filter, not a name list
    const [field, op, spec] = ord!.filters[0]
    expect([field, op]).toEqual(['row_id', 'related'])
    expect(spec).toMatchObject({ via: LINE, column: 'employee', table: EMP })
    // and the list engine evaluates it to exactly the owning rows
    const listed = await listWith(admin, ORDER, ord!.filters)
    expect(listed.sort()).toEqual(['ORD-1', 'ORD-2'])
    // the sub-table itself is never a connection entry — only its owner
    expect(cnx.find((c) => c.table === LINE)).toBeUndefined()
  })

  test('zero-count backlinks are still listed (create-from-here affordance)', async ({ admin }) => {
    await setup(admin)
    const cnx = await getConnections(admin, 'E-002')
    expect(cnx.find((c) => c.table === ATT)).toMatchObject({ count: 0 })
  })

  test('a missing row 404s like a plain GET', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.get(`/api/table/${encodeURIComponent(EMP)}/nope:connections`),
    ).rejects.toMatchObject({ status: 404 })
  })
})

// #102 review finding 1: via-sub-table owner names and counts must go
// through the owner table's full read scoping — a caller must never learn
// the NAME of a parent row they cannot read, and `count` must equal what
// their filtered list will actually show.
describe('NAV-001: via-link permission scoping', () => {
  const ROLE = 'Cnx Role'

  async function grant(admin: TestClient, table: string, extra: Record<string, unknown> = {}) {
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: table, role: ROLE, can_read: true, ...extra },
    })
  }

  test('own_rows_only: other users’ owners are absent from names AND count', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: ROLE } })
    await grant(admin, EMP)
    await grant(admin, LINE, { can_create: true })
    await grant(admin, ORDER, { can_create: true, own_rows_only: true })
    const alice = await createUser({ roles: [ROLE] })

    await alice.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-MINE', title: 'mine', lines: [{ employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-THEIRS', title: 'theirs', lines: [{ employee: 'E-001' }] },
    })

    const cnx = await getConnections(alice, 'E-001')
    const ord = cnx.find((c) => c.table === ORDER)
    expect(ord).toMatchObject({ count: 1 })
    // NAV-002: no names in the response at all — the filter is relational,
    // and EVALUATING it as alice yields only her own owner rows
    expect(await listWith(alice, ORDER, ord!.filters)).toEqual(['ORD-MINE'])

    // admin still sees both, through the same filter
    const all = await getConnections(admin, 'E-001')
    const ordAll = all.find((c) => c.table === ORDER)!
    expect(ordAll.count).toBe(2)
    expect((await listWith(admin, ORDER, ordAll.filters)).sort()).toEqual([
      'ORD-MINE',
      'ORD-THEIRS',
    ])
  })

  test('Data Scope on the owner table narrows names and count', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: ROLE } })
    await grant(admin, EMP)
    await grant(admin, LINE)
    await grant(admin, ORDER)
    const user = await createUser({ roles: [ROLE] })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-VISIBLE', title: 'v', lines: [{ employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { row_id: 'ORD-HIDDEN', title: 'h', lines: [{ employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: 'Data Scope',
      doc: { user: user.user, allow_table: ORDER, for_value: 'ORD-VISIBLE' },
    })

    const cnx = await getConnections(user, 'E-001')
    const ord = cnx.find((c) => c.table === ORDER)
    expect(ord).toMatchObject({ count: 1 })
    expect(await listWith(user, ORDER, ord!.filters)).toEqual(['ORD-VISIBLE'])
  })

  test('more than 500 owners: exact count, filter has no cap at all', async ({ admin }) => {
    await setup(admin)
    // Bulk-seed 501 owners + one child row each straight through SQL — the
    // generated tables default every audit column, and the engine round
    // trip for 1000+ rows is not what this test measures.
    await sql.unsafe(`
      insert into cnx_order (row_id, title)
      select 'ORD-' || lpad(i::text, 4, '0'), 'bulk' from generate_series(1, 501) i`)
    await sql.unsafe(`
      insert into cnx_order_line (row_id, parent, parenttype, parentfield, employee, qty)
      select 'L-' || i, 'ORD-' || lpad(i::text, 4, '0'), 'Cnx Order', 'lines', 'E-001', 1
      from generate_series(1, 501) i`)

    const cnx = await getConnections(admin, 'E-001')
    const ord = cnx.find((c) => c.table === ORDER)!
    expect(ord.count).toBe(501)
    // NAV-002: the relational filter matches ALL 501 owners — the old
    // 500-name cap is gone because there are no names to cap
    const res = await admin.get<{ total: number }>(
      `/api/table/${encodeURIComponent(ORDER)}?filters=${encodeURIComponent(JSON.stringify(ord.filters))}&fields=${encodeURIComponent('["row_id"]')}`,
    )
    expect(res.total).toBe(501)
  })
})

// #102 review finding 4: navigation pickers list tables by each table's OWN
// read permission, not by permission on the metadata `Table` table.
describe('NAV-001: navigable tables', () => {
  test('filters by per-table read permission', async ({ admin, createUser }) => {
    await setup(admin)
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: 'Cnx Nav Role' } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: EMP, role: 'Cnx Nav Role', can_read: true },
    })
    const user = await createUser({ roles: ['Cnx Nav Role'] })

    const mine = await user.get<{ tables: string[] }>('/api/navigable_tables')
    expect(mine.tables).toContain(EMP)
    expect(mine.tables).not.toContain(ORDER)
    // sub-tables are never navigation roots
    expect(mine.tables).not.toContain(LINE)

    const all = await admin.get<{ tables: string[] }>('/api/navigable_tables')
    expect(all.tables).toEqual(expect.arrayContaining([EMP, ORDER]))
  })
})
