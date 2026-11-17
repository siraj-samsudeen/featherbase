// featherbase #1219: an app asks who last changed a column it reads, from the row's own history
// (Version), never who last saved the row: a later save of another column doesn't move it.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { grantRole, makeTable } from './fixtures'
import { sql } from '../src/db'
import { createTable, tableRelation } from '../src/table-engine'
import { saveDoc } from '../src/document'
import { baseTablesReader, type BaseTablesDeclaration } from '../src/change-proposals'

const PLACE = 'Changed Place'
const declaration = { read: { [PLACE]: ['section', 'ends_on'] }, propose: {} } as BaseTablesDeclaration
const save = async (row: Record<string, unknown>, user: string) => {
  const [current] = row.row_id ? await sql`select updated_at from ${sql(await tableRelation(PLACE))} where row_id = ${row.row_id as string}` : []
  return saveDoc(PLACE, { ...row, ...(current ? { updated_at: current.updated_at } : {}) }, user, current ? 'upsert' : 'insert', { skipPermissions: true })
}

describe('who last changed a column', () => {
  test('names who set it, at what time, and is not moved by a later save of another column', async () => {
    await createTable({ name: PLACE, label: PLACE, columns: [
      { column_name: 'section', label: 'Section', column_type: 'Data' }, { column_name: 'ends_on', label: 'Ends on', column_type: 'Date' },
      { column_name: 'note', label: 'Note', column_type: 'Data' }] })
    await save({ row_id: 'P1', section: 'Silk' }, 'psn_maker')
    await save({ row_id: 'P2', section: 'Sarees' }, 'psn_maker')
    await save({ row_id: 'P1', ends_on: '2026-11-13' }, 'svc_made_up_import')
    await save({ row_id: 'P1', section: 'Silk corner' }, 'psn_later')
    const { helper } = baseTablesReader('demo', declaration, [PLACE])
    const by = await helper.changedBy(PLACE, { rows: ['P1', 'P2', 'P9'], column: 'ends_on' })
    expect(Object.keys(by)).toEqual(['P1'])
    expect(by.P1.by).toBe('svc_made_up_import')
    expect(typeof by.P1.at).toBe('string')
    expect((await helper.changedBy(PLACE, { rows: ['P1'], column: 'section' })).P1.by).toBe('psn_later')
    // Nothing asked, nothing read.
    expect(await helper.changedBy(PLACE, { rows: [], column: 'ends_on' })).toEqual({})
  })

  test('refused: a column the app does not read, a Table it does not declare, one the instance does not link', async () => {
    await createTable({ name: PLACE, label: PLACE, columns: [
      { column_name: 'section', label: 'Section', column_type: 'Data' }, { column_name: 'ends_on', label: 'Ends on', column_type: 'Date' },
      { column_name: 'note', label: 'Note', column_type: 'Data' }] })
    const { helper } = baseTablesReader('demo', declaration, [PLACE])
    await expect(helper.changedBy(PLACE, { rows: ['P1'], column: 'note' })).rejects.toThrow('has not declared column note')
    await expect(helper.changedBy('Other Place', { rows: ['P1'], column: 'ends_on' })).rejects.toThrow('has not declared Table Other Place')
    await expect(baseTablesReader('demo', declaration, []).helper.changedBy(PLACE, { rows: ['P1'], column: 'ends_on' })).rejects.toThrow('linked Tables')
    await expect(helper.changedBy(PLACE, { rows: 'P1' as never, column: 'ends_on' })).rejects.toThrow()
  })

  test('a row list() hides behind mandatory privacy has no history here either', async ({ admin, createUser }) => {
    const table = await makeTable(admin, { name: 'Private Placement', access_policy: { version: 1, roles: ['Placement Member'], shared_column: 'shared' }, columns: ['title', 'shared:Check'] })
    await grantRole(admin, { table: table.name, role: 'Placement Member', can_read: true, can_create: true, can_write: true })
    const owner = await createUser({ roles: ['Placement Member'] })
    const row = await owner.post<Record<string, unknown>>('/api/save_row', { table: table.name, row: { title: 'Private draft' } })
    await owner.post('/api/save_row', { table: table.name, row: { row_id: row.row_id, updated_at: row.updated_at, title: 'Private, changed' } })
    // The reader runs as the built-in Administrator: a member of the Table, still not the row's creator.
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('hr-1219-admin', 'Administrator', 'Person', 'roles', 'Placement Member')`
    const { helper } = baseTablesReader('demo', { read: { [table.name]: ['title'] }, propose: {} } as BaseTablesDeclaration, [table.name])
    expect(await helper.list(table.name, { fields: ['title'], filters: [['row_id', '=', String(row.row_id)]] })).toEqual([])
    expect(await helper.changedBy(table.name, { rows: [String(row.row_id)], column: 'title' })).toEqual({})
  })
})
