import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { physicalRowKey } from '../src/meta'
import { tableName } from '../src/platform-schema'
import { classifyColumns } from '../src/person-registry'
import { renderTemplate } from '../src/email'

// #436: a Table or Column named after an Object.prototype key must not pick up
// the built-in JavaScript member in a name lookup and break the generated SQL.
const PROTOTYPE_KEYS = ['constructor', 'valueOf', 'toString', 'hasOwnProperty']

describe('Tables and Columns named after JavaScript built-ins (#436)', () => {
  test('the name lookups return plain names, never a built-in', () => {
    for (const name of [...PROTOTYPE_KEYS, '__proto__']) {
      expect(tableName(name)).toBe(name.toLowerCase())
      expect(physicalRowKey(name)).toBe('row_id')
    }
    expect(renderTemplate('[{{ doc.constructor }}{{ doc.toString }}]', { title: 'x' })).toBe('[]')
    expect(tableName('Table')).toBe('table_def')
    expect(physicalRowKey('Table')).toBe('name')
  })

  test.for(PROTOTYPE_KEYS)('a row round-trips in a Table named %s with a Column named constructor', async (name, { admin }) => {
    await admin.post('/api/table_def', { name, columns: [
      { column_name: 'constructor', column_type: 'Data' },
      { column_name: 'title', column_type: 'Data' },
    ] })
    const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: name, row: { constructor: 'built', title: 'first' } })
    expect(saved).toMatchObject({ constructor: 'built', title: 'first' })
    const read = await admin.get(`/api/table/${encodeURIComponent(name)}/${encodeURIComponent(saved.row_id)}`)
    expect(read).toMatchObject({ row_id: saved.row_id, constructor: 'built', title: 'first' })
    const [stored] = await sql`select "constructor", title from ${sql(`featherbase.${name.toLowerCase()}`)}`
    expect(stored).toEqual({ constructor: 'built', title: 'first' })
  })

  test('a Column named constructor left empty stays empty', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Proto Empty', columns: [
      { column_name: 'constructor', column_type: 'Data' },
      { column_name: 'title', column_type: 'Data' },
    ] })
    const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Proto Empty', row: { title: 'only a title' } })
    const [stored] = await sql`select "constructor" from featherbase.proto_empty where row_id = ${saved.row_id}`
    expect(stored.constructor).toBeNull()
  })

  test('a Column named constructor gets its default, and a Reference named constructor may be left out', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Proto Target', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Proto Defaults', track_changes: true, columns: [
      { column_name: 'constructor', column_type: 'Data', default_value: 'from default' },
      { column_name: 'title', column_type: 'Data' },
    ] })
    await admin.post('/api/table_def', { name: 'Proto Links', columns: [
      { column_name: 'constructor', column_type: 'Reference', reference_table: 'Proto Target' },
      { column_name: 'title', column_type: 'Data' },
    ] })
    const defaulted = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Proto Defaults', row: { title: 'x' } })
    expect((await sql`select "constructor" from featherbase.proto_defaults where row_id = ${defaulted.row_id}`)[0].constructor).toBe('from default')
    const linked = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Proto Links', row: { title: 'no link' } })
    expect((await sql`select "constructor" from featherbase.proto_links where row_id = ${linked.row_id}`)[0].constructor).toBeNull()
  })

  test('a Table named by a Column called constructor still requires that Column', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Proto Named', id_pattern: 'field:constructor', columns: [
      { column_name: 'constructor', column_type: 'Data' },
      { column_name: 'title', column_type: 'Data' },
    ] })
    const res = await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Proto Named', row: { title: 'no name' } }) })
    expect(res.status).toBe(417)
    expect(await res.json()).toMatchObject({ error: { message: 'Naming field constructor is required' } })
    expect(await admin.post('/api/save_row', { table: 'Proto Named', row: { constructor: 'named', title: 'x' } })).toMatchObject({ row_id: 'named' })
  })

  test('the person-column classification treats a Table named constructor like any other', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'constructor', columns: [{ column_name: 'name', column_type: 'Data' }] })
    const { classified, unclassified } = await classifyColumns()
    const mine = [...classified, ...unclassified].filter((c) => c.relation === 'constructor' && c.column === 'name')
    expect(mine).toHaveLength(1)
    expect(mine[0]).not.toMatchObject({ rule: 'declared' })
  })
})
