import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectApiError, makeTable } from './fixtures'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { duplicateValueFields } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Doc Test Note'

// Each test creates its Table inside its OWN transaction — the sandbox
// rolls it back, so there is no shared beforeAll state and no cleanup.
const makeDT = (admin: TestClient) => makeTable(admin, { name: DT, columns: ['title', 'qty:Int'] })

describe('DOC-001: save_row inserts through the Document engine', () => {
  test('inserts, auto-populates standard columns, and is readable back', async ({ admin }) => {
    const dt = await makeDT(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: DT,
      row: { title: 'hello', qty: 3 },
    })
    expect(doc.row_id).toMatch(/^[0-9a-f]{10}$/)
    expect(doc.created_by).toBe('Administrator')
    expect(Date.parse(doc.created_at as string)).not.toBeNaN()
    expect(doc.updated_at).toBe(doc.created_at) // same stamp on insert
    expect(doc.status).toBe('draft')
    expect(doc.title).toBe('hello')
    expect(doc.qty).toBe(3)

    const read = await admin.get<Record<string, unknown>>(dt.rowUrl(String(doc.row_id)))
    expect(read.title).toBe('hello')
  })

  // #541: a whole-number column is stored as bigint, which the database
  // client hands back as text unless told otherwise.
  test('a whole number reads back as a number, from the row and from the list', async ({ admin }) => {
    const dt = await makeDT(admin)
    const doc = await admin.post<Record<string, unknown>>('/api/save_row', { table: DT, row: { title: 'n', qty: 13 } })
    expect((await admin.get<Record<string, unknown>>(dt.rowUrl(String(doc.row_id)))).qty).toBe(13)
    const list = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["qty"]')}`,
    )
    expect(list.data.map((r) => r.qty)).toEqual([13])
  })

  test('rejects unknown fields with a field-wise error', async ({ admin }) => {
    await makeDT(admin)
    await expect(
      admin.post('/api/save_row', { table: DT, row: { title: 'x', nope: 1 } }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { nope: expect.stringMatching(/Unknown field/) },
    })
  })

  test('404s for unknown table and unknown doc', async ({ admin }) => {
    const dt = await makeDT(admin)
    await expect(
      admin.post('/api/save_row', { table: 'Missing DT', row: {} }),
    ).rejects.toMatchObject({ status: 404 })
    await expectApiError(admin.get(dt.rowUrl('zzz')), { status: 404 })
  })

  test('rejects malformed envelope', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { row: { a: 1 } })).rejects.toMatchObject({
      status: 417,
    })
  })
})

describe('DOC: what a save refuses, and the field it names', () => {
  test('a Table whose stored id pattern the engine does not know refuses new rows rather than guessing an id', async ({ admin }) => {
    await makeDT(admin)
    await sql`update table_def set id_pattern = 'weird' where name = ${DT}`
    invalidateMeta(DT)
    await expectApiError(admin.post('/api/save_row', { table: DT, row: { title: 'x' } }), {
      status: 417, message: expect.stringContaining('Unsupported id_pattern rule weird'),
    })
  })

  test('a duplicate is blamed on the columns Postgres names, or on the constraint when it names none', () => {
    expect(duplicateValueFields('Doc Test Note', { constraint_name: 'x', detail: 'Key (language, "source_text")=(fr, Save) already exists.' }))
      .toEqual(['language', 'source_text'])
    // Without a detail (the connecting role may not see the key): the generated single-column constraint, else the row id.
    expect(duplicateValueFields('Doc Test Note', { constraint_name: 'doc_test_note_code_uq' })).toEqual(['code'])
    expect(duplicateValueFields('Doc Test Note', { constraint_name: 'doc_test_note_pkey' })).toEqual(['row_id'])
    expect(duplicateValueFields('Doc Test Note', {})).toEqual(['row_id'])
    // The case-insensitive Person indexes name an expression, so they are mapped by name. (The
    // Person controller refuses a taken username first; the index answers only a race past it.)
    expect(duplicateValueFields('Person', { constraint_name: 'person_username_lower_uq', detail: 'Key (lower(username::text))=(dup) already exists.' }))
      .toEqual(['username'])
  })

  test('a Reference whose target Table no longer exists is refused on that field', async ({ admin }) => {
    await makeTable(admin, { name: 'Doc Ref Holder', columns: ['title', { column_name: 'note', column_type: 'Reference', reference_table: DT }] })
    await makeDT(admin)
    await sql`update column_def set reference_table = 'Doc Gone Target' where parent = 'Doc Ref Holder' and column_name = 'note'`
    invalidateMeta('Doc Ref Holder')
    await expectApiError(admin.post('/api/save_row', { table: 'Doc Ref Holder', row: { title: 't', note: 'anything' } }), {
      status: 417, fields: { note: 'Reference target Table Doc Gone Target does not exist' },
    })
  })

  test('nested rows sent as anything but a list are refused on that field', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Doc Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Doc Order', columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Doc Line' }] })
    await expectApiError(admin.post('/api/save_row', { table: 'Doc Order', row: { lines: { item: 'bolt' } } }), {
      status: 417, fields: { lines: 'lines must be an array of rows' },
    })
  })
})
