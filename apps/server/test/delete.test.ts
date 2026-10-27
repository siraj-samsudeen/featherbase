import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { readStored } from '../src/storage'

const CUSTOMER = 'Del Customer'
const INVOICE = 'Del Invoice'
const ROW = 'Del Line Row'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: CUSTOMER,
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data' }],
  })
  await admin.post('/api/table_def', {
    name: ROW,
    kind: 'sub_table',
    columns: [{ column_name: 'supplier', column_type: 'Reference', reference_table: CUSTOMER }],
  })
  await admin.post('/api/table_def', {
    name: INVOICE,
    columns: [
      { column_name: 'customer', column_type: 'Reference', reference_table: CUSTOMER },
      { column_name: 'lines', column_type: 'Sub-table', row_table: ROW },
    ],
  })
  for (const n of ['Acme', 'Globex', 'Initech', 'Umbrella'])
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: n } })
}

const docPath = (dt: string, name: string) =>
  `/api/table/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`

describe('DOC-006: delete with referential integrity', () => {
  test('blocks deleting a doc linked from a parent field, naming the holder', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: INVOICE, row: { customer: 'Acme' } })
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining(INVOICE),
    })
  })

  test('blocks deleting a doc linked from a CHILD row, naming the parent doc', async ({
    admin,
  }) => {
    await setup(admin)
    const inv = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: INVOICE,
      row: { lines: [{ supplier: 'Globex' }] },
    })
    await expect(admin.delete(docPath(CUSTOMER, 'Globex'))).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining(String(inv.row_id)),
    })
  })

  test('deletes an unlinked doc, and its own child rows with it', async ({ admin }) => {
    await setup(admin)
    await admin.delete(docPath(CUSTOMER, 'Initech'))
    const inv = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: INVOICE,
      row: { lines: [{ supplier: 'Umbrella' }] },
    })
    // Unlink first by deleting the invoice, then the customer is deletable.
    await admin.delete(docPath(INVOICE, String(inv.row_id)))
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from featherbase.del_line_row where parent='${inv.row_id}'`,
    )
    expect(count).toBe(0)
    await admin.delete(docPath(CUSTOMER, 'Umbrella'))
  })

  test('404s deleting a nonexistent doc; blocks direct child-row deletion', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(admin.delete(docPath(CUSTOMER, 'Ghost'))).rejects.toMatchObject({
      status: 404,
    })
    await expect(admin.delete(docPath(ROW, 'whatever'))).rejects.toMatchObject({
      status: 417,
    })
  })
})

describe('A refusal changes nothing', () => {
  test('a deletion refused because another row links to it leaves the row and its nested rows as they were', async ({ admin }) => {
    await setup(admin)
    const inv = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: INVOICE,
      row: { customer: 'Acme', lines: [{ supplier: 'Globex' }] },
    })
    const before = await admin.get(docPath(INVOICE, String(inv.row_id)))
    // Linked from the invoice: refused.
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({ status: 417 })
    expect(await admin.get(docPath(CUSTOMER, 'Acme'))).toMatchObject({ row_id: 'Acme' })
    expect(await admin.get(docPath(INVOICE, String(inv.row_id)))).toEqual(before)
  })
})

describe('Nested rows and settings are deleted only through what holds them', () => {
  test('a nested row cannot be deleted on its own; its parent keeps it', async ({ admin }) => {
    await setup(admin)
    const inv = await admin.post<{ row_id: string; lines: { row_id: string }[] }>('/api/save_row', {
      table: INVOICE,
      row: { lines: [{ supplier: 'Globex' }] },
    })
    await expect(admin.delete(docPath(ROW, inv.lines[0].row_id))).rejects.toMatchObject({ status: 417 })
    const after = await admin.get<{ lines: unknown[] }>(docPath(INVOICE, inv.row_id))
    expect(after.lines).toHaveLength(1)
  })
})

// SPEC: Deleting a row leaves nothing pointing at it (row-deletion), #321.
// Comments, history, attachments, shares, assignments, tags, notifications,
// workflow steps and row-level data scopes name a row by id in plain text.
// Left behind, they would point at nothing, and a share would wake up for
// any later row given the same id.
describe('Deleting a row leaves nothing pointing at it', () => {
  const activity = (table: string, name: string) => sql`
    select 'comment' as kind from comment where ref_table = ${table} and ref_name = ${name}
    union all select 'version' from version where ref_table = ${table} and ref_name = ${name}
    union all select 'file' from file where ref_table = ${table} and ref_name = ${name}
    union all select 'share' from share where share_table = ${table} and share_name = ${name}
    union all select 'tag' from tag_link where ref_table = ${table} and ref_name = ${name}
    union all select 'todo' from todo where ref_table = ${table} and reference_name = ${name}
    union all select 'notification' from notification_log where ref_table = ${table} and ref_name = ${name}
    union all select 'workflow step' from workflow_action where ref_table = ${table} and ref_name = ${name}
    union all select 'data scope' from data_scope where allow_table = ${table} and for_value = ${name}
    order by 1`

  async function giveActivity(table: string, name: string) {
    await sql`insert into tag_link (ref_table, ref_name, tag) values (${table}, ${name}, 'del-vip')`
    for (const [relation, tableColumn, nameColumn] of [
      ['comment', 'ref_table', 'ref_name'], ['share', 'share_table', 'share_name'],
      ['todo', 'ref_table', 'reference_name'], ['notification_log', 'ref_table', 'ref_name'],
      ['workflow_action', 'ref_table', 'ref_name'], ['data_scope', 'allow_table', 'for_value'],
    ] as const)
      await sql`insert into ${sql(`featherbase.${relation}`)} ${sql({
        row_id: `${relation} ${table} ${name}`, [tableColumn]: table, [nameColumn]: name,
        ...(relation === 'data_scope' || relation === 'share' ? { person: 'Administrator' } : {}),
      })}`
  }

  test('a plain row goes with its comments, history, attachments, shares and the rest', async ({ admin }) => {
    await setup(admin)
    const acme = await admin.get<{ updated_at: string }>(docPath(CUSTOMER, 'Acme'))
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'Acme', updated_at: acme.updated_at, city: 'Pune' } })
    const form = new FormData()
    form.append('file', new File(['invoice 17'], 'invoice-17.txt', { type: 'text/plain' }))
    form.append('ref_table', CUSTOMER)
    form.append('ref_name', 'Acme')
    const uploaded = await (await admin.fetch('/api/upload_file', { method: 'POST', body: form })).json() as { file_url: string }
    await giveActivity(CUSTOMER, 'Acme')
    // The same id under another Table is someone else's activity.
    await giveActivity(INVOICE, 'Acme')
    const kinds = ['comment', 'data scope', 'file', 'notification', 'share', 'tag', 'todo', 'version', 'workflow step']
    expect((await activity(CUSTOMER, 'Acme')).map((r) => r.kind)).toEqual(kinds)

    await admin.delete(docPath(CUSTOMER, 'Acme'))

    expect(await activity(CUSTOMER, 'Acme')).toEqual([])
    await expect(readStored(uploaded.file_url)).rejects.toThrow()
    // A new row given the same id starts clean.
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'Acme' } })
    expect(await admin.get<{ comments: unknown[]; versions: unknown[] }>(`/api/activity/${encodeURIComponent(CUSTOMER)}/Acme`))
      .toMatchObject({ comments: [], versions: [] })
    expect((await activity(INVOICE, 'Acme')).map((r) => r.kind))
      .toEqual(['comment', 'data scope', 'notification', 'share', 'tag', 'todo', 'workflow step'])
  })

  test('a refused deletion keeps the row\'s activity', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: INVOICE, row: { customer: 'Acme' } })
    await giveActivity(CUSTOMER, 'Acme')
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({ status: 417 })
    expect(await activity(CUSTOMER, 'Acme')).toHaveLength(7)
  })
})
