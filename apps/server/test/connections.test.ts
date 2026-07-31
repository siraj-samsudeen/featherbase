import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// Relational navigation (#100): GET /api/table/:table/:name:connections
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
  await admin.post(`/api/table/${encodeURIComponent(EMP)}`, { name: 'E-001' })
  await admin.post(`/api/table/${encodeURIComponent(EMP)}`, { name: 'E-002' })
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

  test('via-sub-table backlinks surface the owning table with an in-filter', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { name: 'ORD-1', title: 'one', lines: [{ employee: 'E-001' }, { employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { name: 'ORD-2', title: 'two', lines: [{ employee: 'E-001' }] },
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: { name: 'ORD-3', title: 'three', lines: [{ employee: 'E-002' }] },
    })

    const cnx = await getConnections(admin, 'E-001')
    const ord = cnx.find((c) => c.table === ORDER)
    expect(ord).toBeDefined()
    expect(ord).toMatchObject({ column: 'employee', via: LINE, count: 2 })
    const [field, op, value] = ord!.filters[0]
    expect([field, op]).toEqual(['name', 'in'])
    expect([...(value as string[])].sort()).toEqual(['ORD-1', 'ORD-2'])
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
