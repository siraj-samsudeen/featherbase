import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { PLATFORM_SCHEMA } from '../src/platform-schema'

// DOC-012: rename a Customer; documents that linked to the old name now
// point at the new name — parent Link fields and child-table Link fields.

const CUST = 'Rn Customer'
const ORDER = 'Rn Order'
const ITEM = 'Rn Order Item'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: CUST,
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data' }],
  })
  await admin.post('/api/table_def', {
    name: ITEM,
    kind: 'sub_table',
    columns: [{ column_name: 'supplier', column_type: 'Reference', reference_table: CUST }],
  })
  await admin.post('/api/table_def', {
    name: ORDER,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'customer', column_type: 'Reference', reference_table: CUST },
      { column_name: 'lines', column_type: 'Sub-table', row_table: ITEM },
    ],
  })
}

describe('DOC-012: rename document + cascade Link references', () => {
  test('updates the primary key and every Link that referenced the old name', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Acme',
      city: 'NYC',
    })
    await admin.post('/api/save_row', {
      table: ORDER,
      row: {
        row_id: 'ORD-1',
        customer: 'Acme',
        lines: [{ supplier: 'Acme' }],
      },
    })

    const renamed = await admin.post<{ row_id: string }>(
      `/api/table/${encodeURIComponent(CUST)}/Acme:rename`,
      { new_name: 'Acme Corp' },
    )
    expect(renamed.row_id).toBe('Acme Corp')

    // Old name is gone, new name exists.
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Acme'`).toHaveLength(0)
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Acme Corp'`).toHaveLength(1)

    // Parent Link field updated.
    const order = await admin.get<{ customer: string; lines: { supplier: string }[] }>(
      `/api/table/${encodeURIComponent(ORDER)}/ORD-1`,
    )
    expect(order.customer).toBe('Acme Corp')
    // Child-table Link field updated.
    expect(order.lines[0].supplier).toBe('Acme Corp')
  })

  test('rejects a rename that collides with an existing name', async ({ admin }) => {
    await setup(admin)
    // The colliding target must exist in THIS test's transaction.
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Acme Corp',
      city: 'NYC',
    })
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Globex',
      city: 'LA',
    })
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Globex:rename`, { new_name: 'Acme Corp' }),
    ).rejects.toMatchObject({ status: 409, type: 'ConflictError' })
    // Globex is untouched.
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Globex'`).toHaveLength(1)
  })

  test('404s renaming a document that does not exist', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Nope:rename`, { new_name: 'Whatever' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('Rename a row and every link follows', () => {
  test("the row keeps its own values and nested rows under the new id", async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), { row_id: 'Acme', city: 'NYC' })
    await admin.post('/api/save_row', {
      table: ORDER,
      row: { row_id: 'ORD-9', customer: 'Acme', lines: [{ supplier: 'Acme' }, { supplier: 'Acme' }] },
    })
    await admin.post(`/api/table/${encodeURIComponent(ORDER)}/ORD-9:rename`, { new_name: 'ORD-10' })
    const order = await admin.get<{ customer: string; lines: unknown[] }>(
      `/api/table/${encodeURIComponent(ORDER)}/ORD-10`,
    )
    expect(order.customer).toBe('Acme')
    expect(order.lines).toHaveLength(2)
    await expect(admin.get(`/api/table/${encodeURIComponent(ORDER)}/ORD-9`)).rejects.toMatchObject({ status: 404 })
  })

  // SPEC: A renamed row keeps its activity (tables-and-fields), #509.
  test("a renamed row's comments and change history come with it", async ({ admin }) => {
    await setup(admin)
    const created = await admin.post<{ updated_at: string }>('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Acme',
      city: 'NYC',
    })
    await admin.post('/api/save_row', {
      table: CUST,
      row: { row_id: 'Acme', updated_at: created.updated_at, city: 'Boston' },
    })
    await admin.post('/api/save_row', {
      table: 'Comment',
      row: { ref_table: CUST, ref_name: 'Acme', content: 'called them today' },
    })
    const before = await admin.get<{ comments: unknown[]; versions: unknown[] }>(
      `/api/activity/${encodeURIComponent(CUST)}/Acme`,
    )
    expect(before.comments).toHaveLength(1)
    expect(before.versions).toHaveLength(1)

    await admin.post(`/api/table/${encodeURIComponent(CUST)}/Acme:rename`, { new_name: 'Acme Corp' })
    const after = await admin.get<{ comments: unknown[]; versions: unknown[] }>(
      `/api/activity/${encodeURIComponent(CUST)}/${encodeURIComponent('Acme Corp')}`,
    )
    expect(after.comments).toHaveLength(1)
    expect(after.versions).toHaveLength(1)
  })

  // SPEC: A renamed row keeps its activity (tables-and-fields), #509. Every platform
  // record that names a row by its id in plain text follows the rename; the
  // same id under another Table is left alone.
  test('every record that names the row by id follows the rename, and only that row', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), { row_id: 'Acme', city: 'NYC' })
    const holders = [
      ['access_log', 'ref_table', 'reference_name'],
      ['comment', 'ref_table', 'ref_name'],
      ['data_scope', 'allow_table', 'for_value'],
      ['email_queue', 'ref_table', 'reference_name'],
      ['file', 'ref_table', 'ref_name'],
      ['notification_log', 'ref_table', 'ref_name'],
      ['share', 'share_table', 'share_name'],
      ['todo', 'ref_table', 'reference_name'],
      ['version', 'ref_table', 'ref_name'],
      ['workflow_action', 'ref_table', 'ref_name'],
    ] as const
    for (const [relation, tableColumn, nameColumn] of holders) {
      for (const owner of [CUST, ORDER])
        await sql`insert into ${sql(`${PLATFORM_SCHEMA}.${relation}`)} ${sql({
          row_id: `${relation} ${owner}`, [tableColumn]: owner, [nameColumn]: 'Acme',
          ...(relation === 'data_scope' || relation === 'share' ? { person: 'Administrator' } : {}),
        })}`
    }
    for (const owner of [CUST, ORDER])
      await sql`insert into tag_link (ref_table, ref_name, tag) values (${owner}, 'Acme', 'rn-tag')`

    await admin.post(`/api/table/${encodeURIComponent(CUST)}/Acme:rename`, { new_name: 'Acme Corp' })

    for (const [relation, tableColumn, nameColumn] of [...holders, ['tag_link', 'ref_table', 'ref_name'] as const]) {
      const rows = await sql`
        select ${sql(tableColumn)} as owner, ${sql(nameColumn)} as name from ${sql(`${PLATFORM_SCHEMA}.${relation}`)}
        where ${sql(tableColumn)} in ${sql([CUST, ORDER])} and ${sql(nameColumn)} in ('Acme', 'Acme Corp')
        order by 1`
      expect({ relation, rows: rows.map((r) => [r.owner, r.name]) })
        .toEqual({ relation, rows: [[CUST, 'Acme Corp'], [ORDER, 'Acme']] })
    }
  })

  // A tag left under the new id by an earlier row of that id must not make
  // the rename collide; the row ends with the tag once.
  test('a tag already under the new id does not stop the rename', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), { row_id: 'Acme', city: 'NYC' })
    for (const name of ['Acme', 'Acme Corp'])
      await sql`insert into tag_link (ref_table, ref_name, tag) values (${CUST}, ${name}, 'rn-vip')`
    await admin.post(`/api/table/${encodeURIComponent(CUST)}/Acme:rename`, { new_name: 'Acme Corp' })
    expect(await sql`select ref_name from tag_link where ref_table = ${CUST} order by 1`)
      .toEqual([{ ref_name: 'Acme Corp' }])
  })
})
