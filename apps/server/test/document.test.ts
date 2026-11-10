import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectApiError, expectRefused, makeTable, tableRef } from './fixtures'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { duplicateValueFields, saveSingle, saveSystemRow } from '../src/document'
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
    expect(doc.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3
    expect(doc.created_by).toBe('Administrator')
    expect(Date.parse(doc.created_at as string)).not.toBeNaN()
    expect(doc.updated_at).toBe(doc.created_at) // same stamp on insert
    expect(doc.submission_status).toBe('draft')
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
    await expectRefused(admin.get(dt.rowUrl('zzz')), 404)
  })

  test('rejects malformed envelope', async ({ admin }) => {
    await expect(admin.post('/api/save_row', { row: { a: 1 } })).rejects.toMatchObject({
      status: 417,
    })
  })
})

describe('DOC: what a save refuses, and the field it names', () => {
  test('specialized server writers refuse the wrong Table kind without writing a row', async ({ admin }) => {
    const dt = await makeDT(admin)
    await expect(saveSystemRow(DT, { title: 'not a system row' }, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError', message: `${DT} is not system-written; use saveDoc`,
    })
    await expect(saveSingle(DT, { title: 'not settings' })).rejects.toMatchObject({
      type: 'ValidationError', message: `${DT} is not a Settings Table`,
    })
    expect(await admin.get(`${dt.url}?fields=["title"]`)).toMatchObject({ total: 0, data: [] })
    expect(await sql`select field, value from single_value where table_name = ${DT}`).toEqual([])
  })

  test('the trusted system writer refuses unknown columns before inserting history', async ({ admin: _admin }) => {
    const before = await sql`select row_id, data from version order by row_id`
    await expect(saveSystemRow('Version', { ref_table: DT, ref_name: 'missing', surprise: 'not a column' }, 'Administrator'))
      .rejects.toMatchObject({ type: 'ValidationError', message: 'Unknown Version columns: surprise' })
    expect(await sql`select row_id, data from version order by row_id`).toEqual(before)
  })

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
    // The target exists when the link is made (#511), and goes away afterwards.
    await makeDT(admin)
    await makeTable(admin, { name: 'Doc Ref Holder', columns: ['title', { column_name: 'note', column_type: 'Reference', reference_table: DT }] })
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

  test('a nested row sent as a bare value is refused, and nothing is saved', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Doc Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Doc Order', columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Doc Line' }] })
    await expectApiError(admin.post('/api/save_row', { table: 'Doc Order', row: { lines: ['bolt'] } }), { status: 417 })
    expect(await sql`select row_id from featherbase.doc_order`).toEqual([])
  })

  test('a Currency outside its storage range refuses the whole save and preserves the loaded row', async ({ admin }) => {
    const dt = await makeTable(admin, { name: 'Doc Currency', columns: ['title', 'amount:Currency'] })
    const doc = await admin.post<Record<string, unknown>>(dt.url, { title: 'kept', amount: 12.5 })
    // Currency is numeric(21,9). This is a valid finite number for the
    // metadata schema but exceeds the database's twelve integral digits.
    await expectApiError(admin.post('/api/save_row', {
      table: dt.name,
      row: { row_id: doc.row_id, updated_at: doc.updated_at, title: 'not saved', amount: 1e12 },
    }), { status: 417, type: 'ValidationError', message: '417 ValidationError: Value out of range for a field' })
    expect(await admin.get(dt.rowUrl(String(doc.row_id)))).toMatchObject({
      title: 'kept', amount: '12.500000000', updated_at: doc.updated_at,
    })
    expect(await sql`select data from version where ref_table = ${dt.name} and ref_name = ${String(doc.row_id)}`).toEqual([])
    await expectApiError(admin.post(dt.url, { title: 'not inserted', amount: 1e12 }), {
      status: 417, type: 'ValidationError', message: '417 ValidationError: Value out of range for a field',
    })
    expect(await sql`select title, amount::text as amount from featherbase.doc_currency`).toEqual([
      { title: 'kept', amount: '12.500000000' },
    ])
  })

  test('a File naming a row without its Table is refused without creating an attachment', async ({ admin }) => {
    await expectApiError(admin.post('/api/save_row', {
      table: 'File', row: { file_name: 'doc-no-table.txt', ref_name: 'missing-parent' },
    }), { status: 417, type: 'ValidationError', message: '417 ValidationError: A File on a row must name its Table' })
    expect(await sql`select row_id from file where file_name = 'doc-no-table.txt'`).toEqual([])
  })
})

describe('DOC: child reads defer to their parents', () => {
  test('a share on the parent opens its child without granting access to other parents', async ({ admin, createUser }) => {
    const child = await makeTable(admin, { name: 'Doc Shared Line', kind: 'sub_table', columns: ['item'] })
    const parent = await makeTable(admin, {
      name: 'Doc Shared Order', columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: child.name }],
    })
    const reader = await createUserWithRole(admin, createUser, {
      role: 'Doc Shared Child Reader', table: child.name, can_read: true,
    })
    const first = await admin.post<{ row_id: string; lines: { row_id: string }[] }>(parent.url, { lines: [{ item: 'shared bolt' }] })
    const other = await admin.post<{ row_id: string; lines: { row_id: string }[] }>(parent.url, { lines: [{ item: 'private bolt' }] })
    await expectRefused(reader.get(child.rowUrl(first.lines[0].row_id)), 403)
    await admin.post('/api/save_row', {
      table: 'Share', row: { share_table: parent.name, share_name: first.row_id, person: reader.user, read: true },
    })
    expect(await reader.get(child.rowUrl(first.lines[0].row_id))).toMatchObject({ item: 'shared bolt', parent: first.row_id })
    await expectRefused(reader.get(child.rowUrl(other.lines[0].row_id)), 403)
  })
})

describe('DOC: lifecycle and rename guards', () => {
  test('echoing the current workflow state permits an edit but changing it refuses the whole edit', async ({ admin }) => {
    const dt = await makeTable(admin, {
      name: 'Doc Workflow Echo',
      columns: ['title', { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' }],
    })
    await admin.post('/api/save_row', {
      table: 'Workflow', row: {
        row_id: 'Doc Echo Workflow', ref_table: dt.name, is_active: true, state_field: 'stage',
        states: [{ state: 'Open', target_status: 'draft' }, { state: 'Closed', target_status: 'draft' }],
        transitions: [{ state: 'Open', action: 'Close', next_state: 'Closed', allowed: 'System Manager' }],
      },
    })
    const doc = await admin.post<Record<string, unknown>>(dt.url, { title: 'original' })
    const edited = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: dt.name, row: { row_id: doc.row_id, updated_at: doc.updated_at, title: 'edited', stage: 'Open' },
    })
    expect(edited).toMatchObject({ title: 'edited', stage: 'Open' })
    await expectApiError(admin.post('/api/save_row', {
      table: dt.name, row: { row_id: doc.row_id, updated_at: edited.updated_at, title: 'not saved', stage: 'Closed' },
    }), { status: 417, type: 'ValidationError', message: expect.stringContaining('use a workflow action') })
    expect(await sql`select title, stage from featherbase.doc_workflow_echo where row_id = ${String(doc.row_id)}`).toEqual([
      { title: 'edited', stage: 'Open' },
    ])
  })

  test('submit and cancel report a missing row without creating one', async ({ admin }) => {
    const dt = await makeTable(admin, { name: 'Doc Missing Lifecycle', is_submittable: true, columns: ['title'] })
    for (const action of ['submit', 'cancel'])
      await expectApiError(admin.post(`${dt.rowUrl('gone')}:${action}`), {
        status: 404, type: 'NotFoundError', message: `404 NotFoundError: ${dt.name} gone not found`,
      })
    expect(await sql`select row_id from featherbase.doc_missing_lifecycle`).toEqual([])
  })

  test('a non-submittable row cannot be amended and remains unchanged', async ({ admin }) => {
    const dt = await makeDT(admin)
    const doc = await admin.post<{ row_id: string }>(dt.url, { title: 'original', qty: 2 })
    await expectApiError(admin.post(`${dt.rowUrl(doc.row_id)}:amend`), {
      status: 417, type: 'ValidationError', message: `417 ValidationError: ${DT} is not submittable`,
    })
    expect(await sql`select row_id, title, qty::int as qty, submission_status from featherbase.doc_test_note`).toEqual([
      { row_id: doc.row_id, title: 'original', qty: 2, submission_status: 'draft' },
    ])
  })

  test('blank rename targets are refused and an unchanged trimmed id is a read-only round trip', async ({ admin }) => {
    const dt = await makeDT(admin)
    const doc = await admin.post<Record<string, unknown>>(dt.url, { title: 'original', qty: 2 })
    const url = dt.rowUrl(String(doc.row_id))
    await expectApiError(admin.post(`${url}:rename`, { new_name: '   ' }), {
      status: 417, type: 'ValidationError', message: '417 ValidationError: A new Row ID is required', fields: { row_id: 'Required' },
    })
    expect(await admin.post(`${url}:rename`, { new_name: ` ${doc.row_id} ` })).toEqual(doc)
    expect(await admin.get(url)).toEqual(doc)
    expect(await sql`select row_id from version where ref_table = ${DT} and ref_name = ${String(doc.row_id)}`).toEqual([])
  })

  test('settings, child, and engine-managed Tables refuse the generic rename action', async ({ admin }) => {
    const settings = await makeTable(admin, { name: 'Doc Rename Settings', kind: 'settings', columns: ['title'] })
    const child = await makeTable(admin, { name: 'Doc Rename Child', kind: 'sub_table', columns: ['item'] })
    for (const [dt, id] of [[settings, settings.name], [child, 'gone'], [tableRef('Table'), settings.name]] as const)
      await expectApiError(admin.post(`${dt.rowUrl(id)}:rename`, { new_name: 'renamed' }), {
        status: 417, type: 'ValidationError', message: `417 ValidationError: ${dt.name} rows cannot be renamed`,
      })
    expect(await admin.get(settings.rowUrl(settings.name))).toMatchObject({ row_id: settings.name, title: null })
    expect(await sql`select name from table_def where name in (${settings.name}, ${child.name}) order by name`).toEqual([
      { name: child.name }, { name: settings.name },
    ])
  })

  test('amendment copies scalar values and new child rows but skips layout columns', async ({ admin }) => {
    const child = await makeTable(admin, { name: 'Doc Amend Line', kind: 'sub_table', columns: ['item'] })
    const dt = await makeTable(admin, {
      name: 'Doc Amend Layout', is_submittable: true,
      columns: ['title', 'section:Section Break', 'column:Column Break', { column_name: 'lines', column_type: 'Sub-table', row_table: child.name }],
    })
    const doc = await admin.post<{ row_id: string; lines: { row_id: string }[] }>(dt.url, { title: 'copy me', lines: [{ item: 'bolt' }] })
    const url = dt.rowUrl(doc.row_id)
    await admin.post(`${url}:submit`)
    await admin.post(`${url}:cancel`)
    const amended = await admin.post<{ row_id: string; lines: { row_id: string }[] }>(`${url}:amend`)
    expect(amended).toMatchObject({ row_id: `${doc.row_id}-1`, title: 'copy me', submission_status: 'draft', amended_from: doc.row_id, lines: [{ item: 'bolt' }] })
    expect(amended).not.toHaveProperty('section')
    expect(amended).not.toHaveProperty('column')
    expect(amended.lines[0].row_id).not.toBe(doc.lines[0].row_id)
    expect(await sql`select parent, item from featherbase.doc_amend_line order by parent`).toEqual([
      { parent: doc.row_id, item: 'bolt' }, { parent: amended.row_id, item: 'bolt' },
    ])
    expect(await admin.get(url)).toMatchObject({ submission_status: 'cancelled' })
    expect(await admin.get(dt.rowUrl(amended.row_id))).toMatchObject(amended)
  })

  test('settings layout columns are not values and only data fields reach the EAV store', async ({ admin }) => {
    const dt = await makeTable(admin, {
      name: 'Doc Layout Settings', kind: 'settings',
      columns: ['section:Section Break', 'column:Column Break', { column_name: 'count', column_type: 'Int', default_value: '7' }],
    })
    expect(await admin.get(dt.rowUrl(dt.name))).toMatchObject({ row_id: dt.name, count: 7 })
    const saved = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: dt.name, row: { section: 'not data', column: 'not data', count: 9 },
    })
    expect(saved).toMatchObject({ row_id: dt.name, count: 9 })
    expect(saved).not.toHaveProperty('section')
    expect(saved).not.toHaveProperty('column')
    expect(await sql`select field, value from single_value where table_name = ${dt.name} order by field`).toEqual([
      { field: 'count', value: '9' },
    ])
  })
})
