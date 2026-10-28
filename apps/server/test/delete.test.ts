import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

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

// SPEC: A row with comments, history, attachments or shares can't be deleted
// (row-deletion), #321. Owner decision 27-Oct-2026: refuse, as app rows are,
// so no one's work is lost, and name what blocks the delete.
describe('A row with comments, history, attachments or shares can\'t be deleted', () => {
  let n = 0
  const comment = (name: string) =>
    sql`insert into comment (row_id, ref_table, ref_name, content) values (${`del-c-${++n}`}, ${CUSTOMER}, ${name}, 'called them today')`

  test('each kind blocks the delete, and the refusal names what blocks it', async ({ admin }) => {
    await setup(admin)
    // History: one edit.
    const acme = await admin.get<{ updated_at: string }>(docPath(CUSTOMER, 'Acme'))
    await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'Acme', updated_at: acme.updated_at, city: 'Pune' } })
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({
      status: 417, message: expect.stringContaining('it has 1 history entry'),
    })
    // Comments, an attachment and a share on rows with no history.
    await comment('Globex')
    await comment('Globex')
    await sql`insert into file (row_id, ref_table, ref_name, file_name) values ('del-f', ${CUSTOMER}, 'Initech', 'invoice-17.txt')`
    await sql`insert into share (row_id, share_table, share_name, person, read) values ('del-s', ${CUSTOMER}, 'Umbrella', 'Administrator', true)`
    await expect(admin.delete(docPath(CUSTOMER, 'Globex'))).rejects.toMatchObject({
      status: 417, message: expect.stringContaining(`${CUSTOMER} Globex cannot be deleted: it has 2 comments`),
    })
    await expect(admin.delete(docPath(CUSTOMER, 'Initech'))).rejects.toMatchObject({ message: expect.stringContaining('1 attachment') })
    await expect(admin.delete(docPath(CUSTOMER, 'Umbrella'))).rejects.toMatchObject({ message: expect.stringContaining('1 share') })
    for (const name of ['Acme', 'Globex', 'Initech', 'Umbrella'])
      expect(await admin.get(docPath(CUSTOMER, name))).toMatchObject({ row_id: name })
    expect(await sql`select count(*)::int as n from comment where ref_table = ${CUSTOMER} and ref_name = 'Globex'`).toEqual([{ n: 2 }])
  })

  test('several kinds are listed together', async ({ admin }) => {
    await setup(admin)
    await comment('Acme')
    await sql`insert into share (row_id, share_table, share_name, person, read) values ('del-s2', ${CUSTOMER}, 'Acme', 'Administrator', true)`
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({
      message: expect.stringContaining(`${CUSTOMER} Acme cannot be deleted: it has 1 comment and 1 share`),
    })
  })

  test('the same id under another Table does not block, and a row with none of these deletes', async ({ admin }) => {
    await setup(admin)
    await sql`insert into comment (row_id, ref_table, ref_name, content) values ('del-other', ${INVOICE}, 'Acme', 'someone else')`
    await admin.delete(docPath(CUSTOMER, 'Acme'))
    await expect(admin.get(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({ status: 404 })
  })
})
