import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// NAV-002: the 'related' filter operator — relationship-shaped list filters
// compiled to permission-scoped subqueries server-side. World: Supplier ←
// Order ▸ Order Line → Part.

const SUP = 'Rel Supplier'
const PART = 'Rel Part'
const LINE = 'Rel Order Line'
const ORDER = 'Rel Order'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: SUP,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'city', column_type: 'Data' },
      // self-reference so tests can build arbitrarily deep related chains
      { column_name: 'parent_sup', column_type: 'Reference', reference_table: SUP },
    ],
  })
  await admin.post('/api/doctype', {
    name: PART,
    id_pattern: 'prompt',
    columns: [{ column_name: 'part_name', column_type: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: LINE,
    kind: 'sub_table',
    columns: [
      { column_name: 'part', column_type: 'Reference', reference_table: PART },
      { column_name: 'qty', column_type: 'Int', default_value: '1' },
    ],
  })
  await admin.post('/api/doctype', {
    name: ORDER,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'supplier', column_type: 'Reference', reference_table: SUP },
      { column_name: 'total', column_type: 'Currency' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: LINE },
      // #106 review: a SECOND Sub-table column backed by the SAME row
      // table — relationship paths must distinguish the two via parentfield
      { column_name: 'return_lines', column_type: 'Sub-table', row_table: LINE },
    ],
  })
  for (const [name, city] of [['S-A', 'Chennai'], ['S-B', 'Madurai']])
    await admin.post('/api/save_doc', { doctype: SUP, doc: { name, city } })
  for (const name of ['P-1', 'P-2'])
    await admin.post('/api/save_doc', { doctype: PART, doc: { name, part_name: name } })
  await admin.post('/api/save_doc', {
    doctype: ORDER,
    doc: { name: 'O-1', supplier: 'S-A', total: 100, lines: [{ part: 'P-1', qty: 2 }] },
  })
  await admin.post('/api/save_doc', {
    doctype: ORDER,
    doc: { name: 'O-2', supplier: 'S-A', total: 250, lines: [{ part: 'P-2' }] },
  })
  await admin.post('/api/save_doc', {
    doctype: ORDER,
    doc: { name: 'O-3', supplier: 'S-B', total: 40, lines: [{ part: 'P-1' }] },
  })
}

const list = async (client: TestClient, table: string, filters: unknown[]) => {
  const res = await client.get<{ data: { name: string }[]; total: number }>(
    `/api/table/${encodeURIComponent(table)}?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent('["name"]')}&order_by=${encodeURIComponent('name asc')}`,
  )
  return { names: res.data.map((r) => r.name), total: res.total }
}

describe('NAV-002: related filters', () => {
  test('reference column: rows pointing at matching target rows', async ({ admin }) => {
    await setup(admin)
    const { names } = await list(admin, ORDER, [
      ['supplier', 'related', { table: SUP, filters: [['city', '=', 'Chennai']] }],
    ])
    expect(names).toEqual(['O-1', 'O-2'])
  })

  test('via sub-table: rows containing a child that points at the target', async ({ admin }) => {
    await setup(admin)
    const { names } = await list(admin, ORDER, [
      ['name', 'related', { via: LINE, column: 'part', table: PART, filters: [['name', '=', 'P-1']] }],
    ])
    expect(names).toEqual(['O-1', 'O-3'])
  })

  test('parent: child rows whose owning row matches', async ({ admin }) => {
    await setup(admin)
    const { names, total } = await list(admin, LINE, [
      ['parenttype', '=', ORDER],
      ['parent', 'related', { table: ORDER, filters: [['supplier', '=', 'S-A']] }],
    ])
    expect(total).toBe(2)
    expect(names).toHaveLength(2)
  })

  test('nesting: a pane chain two hops deep stays exact', async ({ admin }) => {
    await setup(admin)
    // Order Lines of Orders of Chennai suppliers
    const { total } = await list(admin, LINE, [
      ['parenttype', '=', ORDER],
      [
        'parent',
        'related',
        {
          table: ORDER,
          filters: [['supplier', 'related', { table: SUP, filters: [['city', '=', 'Chennai']] }]],
        },
      ],
    ])
    expect(total).toBe(2) // O-1's line + O-2's line
  })

  test('every hop applies the hopped table’s read scoping', async ({ admin, createUser }) => {
    await setup(admin)
    const ROLE = 'Rel Role'
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    for (const dt of [ORDER, LINE])
      await admin.post('/api/save_doc', {
        doctype: 'Permission',
        doc: { ref_table: dt, role: ROLE, can_read: true },
      })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: SUP, role: ROLE, can_read: true },
    })
    const user = await createUser({ roles: [ROLE] })
    // Data Scope: user may only read supplier S-A
    await admin.post('/api/save_doc', {
      doctype: 'Data Scope',
      doc: { user: user.user, allow_table: SUP, for_value: 'S-A' },
    })
    // "orders of ALL suppliers" through the relationship — S-B is invisible
    // to this user, so its order never surfaces through the hop
    const { names } = await list(user, ORDER, [
      ['supplier', 'related', { table: SUP, filters: [] }],
    ])
    expect(names).toEqual(['O-1', 'O-2'])
  })

  test('a related target the caller cannot read at all is a PermissionError', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const ROLE = 'Rel Narrow Role'
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: ORDER, role: ROLE, can_read: true },
    })
    const user = await createUser({ roles: [ROLE] })
    await expect(
      list(user, ORDER, [['supplier', 'related', { table: SUP, filters: [] }]]),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('malformed specs and illegal shapes are ValidationErrors', async ({ admin }) => {
    await setup(admin)
    const bad = (filters: unknown[]) =>
      expect(list(admin, ORDER, filters)).rejects.toMatchObject({ status: 417 })
    await bad([['supplier', 'related', 'S-A']]) // not an object
    await bad([['supplier', 'related', {}]]) // no table
    await bad([['total', 'related', { table: SUP }]]) // not a Reference column
    await bad([['supplier', 'related', { table: PART }]]) // wrong target
    await bad([['name', 'related', { via: LINE, column: 'qty', table: PART }]]) // via col not a Reference

    // depth cap: a 4th nested hop is rejected (3 is the maximum)
    const supHop = (filters: unknown[]) => ({ table: SUP, filters })
    const deep = [
      [
        'parent',
        'related',
        {
          table: ORDER,
          filters: [
            [
              'supplier',
              'related',
              supHop([['parent_sup', 'related', supHop([['parent_sup', 'related', supHop([])]])]]),
            ],
          ],
        },
      ],
    ]
    await expect(list(admin, LINE, deep)).rejects.toMatchObject({
      status: 417,
      message: expect.stringMatching(/nest at most/),
    })
    // …while exactly 3 hops is fine
    const ok = [
      [
        'parent',
        'related',
        {
          table: ORDER,
          filters: [['supplier', 'related', supHop([['parent_sup', 'related', supHop([])]])]],
        },
      ],
    ]
    await expect(list(admin, LINE, ok)).resolves.toBeDefined()
  })

  test(':aggregate returns true scoped count and an EXACT sum over related filters', async ({
    admin,
  }) => {
    await setup(admin)
    const filters = [['supplier', 'related', { table: SUP, filters: [['city', '=', 'Chennai']] }]]
    const res = await admin.get<{ count: number; sum: string }>(
      `/api/table/${encodeURIComponent(ORDER)}:aggregate?filters=${encodeURIComponent(JSON.stringify(filters))}&sum=total`,
    )
    expect(res.count).toBe(2)
    // #106 review: numeric(21,9) money comes back as a string, never a
    // lossy float — the client decides how to format
    expect(typeof res.sum).toBe('string')
    expect(Number(res.sum)).toBe(350)
  })

  test(':aggregate rejects a non-numeric sum column with 417, not 500', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(
      `/api/table/${encodeURIComponent(ORDER)}:aggregate?sum=supplier`,
    )
    expect(res.status).toBe(417)
  })

  test('non-array filters JSON is a 417, not a 500', async ({ admin }) => {
    await setup(admin)
    for (const path of [
      `/api/table/${encodeURIComponent(ORDER)}?filters=${encodeURIComponent('{}')}`,
      `/api/table/${encodeURIComponent(ORDER)}:aggregate?filters=${encodeURIComponent('{}')}`,
    ]) {
      const res = await admin.fetch(path)
      expect(res.status).toBe(417)
    }
  })

  test('breadth is capped: more than 16 related hops in one request is a 417', async ({
    admin,
  }) => {
    await setup(admin)
    const hop = ['supplier', 'related', { table: SUP, filters: [] }]
    const wide = Array.from({ length: 17 }, () => hop)
    await expect(list(admin, ORDER, wide)).rejects.toMatchObject({
      status: 417,
      message: expect.stringMatching(/hops per request/),
    })
    // 16 sibling hops is fine
    await expect(list(admin, ORDER, wide.slice(0, 16))).resolves.toBeDefined()
  })

  test('a lone column (or lone via) in a spec is rejected, not ignored', async ({ admin }) => {
    await setup(admin)
    await expect(
      list(admin, ORDER, [['supplier', 'related', { table: SUP, column: 'city' }]]),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      list(admin, ORDER, [['name', 'related', { table: PART, via: LINE }]]),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('two Sub-table columns, one row table: parentfield keeps the paths apart', async ({
    admin,
  }) => {
    await setup(admin)
    // O-4 SELLS P-2 but only RETURNS P-1
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: {
        name: 'O-4',
        supplier: 'S-B',
        total: 10,
        lines: [{ part: 'P-2' }],
        return_lines: [{ part: 'P-1' }],
      },
    })

    // child pane scoped to ONE field: O-4's `lines` rows only, never its returns
    const linesOnly = await list(admin, LINE, [
      ['parenttype', '=', ORDER],
      ['parentfield', '=', 'lines'],
      ['parent', 'related', { table: ORDER, filters: [['name', '=', 'O-4']] }],
    ])
    expect(linesOnly.total).toBe(1)

    // via hop WITHOUT parentfield: any field counts → O-4 contains P-1 (returns)
    const anyField = await list(admin, ORDER, [
      ['name', 'related', { via: LINE, column: 'part', table: PART, filters: [['name', '=', 'P-1']] }],
    ])
    expect(anyField.names).toContain('O-4')

    // via hop WITH parentfield 'lines': O-4 does NOT sell P-1 → excluded
    const soldOnly = await list(admin, ORDER, [
      [
        'name',
        'related',
        {
          via: LINE,
          column: 'part',
          table: PART,
          parentfield: 'lines',
          filters: [['name', '=', 'P-1']],
        },
      ],
    ])
    expect(soldOnly.names).toEqual(['O-1', 'O-3'])

    // parentfield must name a real Sub-table column of the via table
    await expect(
      list(admin, ORDER, [
        ['name', 'related', { via: LINE, column: 'part', table: PART, parentfield: 'supplier' }],
      ]),
    ).rejects.toMatchObject({ status: 417 })
    // and never travels without via
    await expect(
      list(admin, ORDER, [['supplier', 'related', { table: SUP, parentfield: 'lines' }]]),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('reviewer finding-3 shapes: sum=Data, sum=position, filters=null are 417s', async ({
    admin,
  }) => {
    await setup(admin)
    for (const qs of [
      `sum=${encodeURIComponent('supplier')}`, // Reference column
      'sum=position', // standard column, numeric but not a declared measure
      `filters=${encodeURIComponent('null')}&sum=total`, // null filters
    ]) {
      const res = await admin.fetch(`/api/table/${encodeURIComponent(ORDER)}:aggregate?${qs}`)
      expect(res.status).toBe(417)
    }
    // a Data column on the sub-table for completeness
    const res = await admin.fetch(
      `/api/table/${encodeURIComponent(PART)}:aggregate?sum=${encodeURIComponent('part_name')}`,
    )
    expect(res.status).toBe(417)
  })
})
