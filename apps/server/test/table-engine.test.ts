import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { changeColumnType, createTable, deleteTable, pgType, renameTable, storedRelation } from '../src/table-engine'
import { sql } from '../src/db'
import { provisionApp } from '../src/app-lifecycle'
import { expectStatus, makeTable } from './fixtures'

const DT = 'Engine Test Item'

describe('META-002: column_type -> Postgres column mapping', () => {
  test.each([
    ['Data', 'varchar(140)'],
    ['Int', 'bigint'],
    ['Float', 'double precision'],
    ['Currency', 'numeric(21,9)'],
    ['Check', 'boolean'],
    ['Choice', 'text'],
    ['Date', 'date'],
    ['Datetime', 'timestamptz'],
    ['Text', 'text'],
    ['Long Text', 'text'],
    ['Reference', 'varchar(140)'],
    ['Attach', 'text'],
    ['JSON', 'jsonb'],
  ])('%s -> %s', (ft, col) => {
    expect(pgType(ft)).toBe(col)
  })

  test.each([['Sub-table'], ['Section Break'], ['Column Break']])(
    '%s produces no column',
    (ft) => {
      expect(pgType(ft)).toBeNull()
    },
  )

  test('throws on unknown column_type', () => {
    expect(() => pgType('Bogus')).toThrow()
  })
})

describe('META-002: Table save validates column_types', () => {
  test('rejects an invalid column_type with a field-wise error', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad Type DT',
        columns: [{ column_name: 'x', column_type: 'Wibble' }],
      }),
    })
    await expectStatus(res, 417)
    const body = await res.json()
    expect(body.error.type).toBe('ValidationError')
    expect(JSON.stringify(body.error.fields)).toContain('column_type')
  })

  test('rejects Choice/Reference/Sub-table columns without their target', async ({ admin }) => {
    await expect(
      admin.post('/api/table_def', {
        name: 'Bad Options DT',
        columns: [{ column_name: 'stage', column_type: 'Reference' }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { stage: expect.stringMatching(/requires reference_table/) },
    })
  })

  test('rejects reserved column names', async ({ admin }) => {
    await expect(
      admin.post('/api/table_def', {
        name: 'Bad Reserved DT',
        columns: [{ column_name: 'created_by', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('accepts a valid definition, persists rows, and 409s on duplicate', async ({ admin }) => {
    const def = {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', reqd: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' },
      ],
    }
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    await expectStatus(res, 201)
    const meta = await res.json()
    expect(meta.columns).toHaveLength(2)

    const dup = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify(def),
    })
    await expectStatus(dup, 409)
  })
})

describe('Table definition defenses leave no partial metadata or storage', () => {
  for (const { columns, fields } of [
    {
      columns: [{ column_name: 'stage', column_type: 'Choice' }],
      fields: { stage: 'Choice column needs at least one choice' },
    },
    {
      columns: [{ column_name: 'lines', column_type: 'Sub-table' }],
      fields: { lines: 'Sub-table column requires row_table' },
    },
    {
      columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'title', column_type: 'Text' }],
      fields: { title: 'duplicate column_name' },
    },
  ]) {
    test(`rejects invalid column metadata: ${Object.values(fields)[0]}`, async ({ admin }) => {
      await expect(admin.post('/api/table_def', { name: 'Engine Invalid Columns', columns }))
        .rejects.toMatchObject({ status: 417, type: 'ValidationError', fields })
      expect(await sql`select name from table_def where name = 'Engine Invalid Columns'`).toEqual([])
      expect(await sql`select to_regclass('featherbase.engine_invalid_columns') as relation`).toEqual([{ relation: null }])
    })
  }

  for (const kind of ['settings', 'sub_table']) {
    test(`rejects incoherent ${kind} source bindings before contacting a source`, async ({ admin }) => {
      // All of these defects are local metadata errors: no live source is needed
      // to reject them, and the missing source must not mask the field errors.
      await expect(admin.post('/api/table_def', {
        name: 'Engine Invalid Binding', kind, data_source: 'Engine Missing Source', is_submittable: true,
        columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Engine Missing Child' }],
      })).rejects.toMatchObject({
        status: 417, type: 'ValidationError', message: expect.stringContaining('Invalid Table definition'),
        fields: {
          data_source: 'Only kind "table" can be bound to a data source',
          is_submittable: 'A source-bound Table cannot be submittable (no docstatus on the source)',
          external_table: 'external_table is required for a bound Table',
          external_pk: 'external_pk is required for a bound Table',
          lines: 'Sub-table columns are not supported on source-bound Tables',
        },
      })
      expect(await sql`select name from table_def where name = 'Engine Invalid Binding'`).toEqual([])
      expect(await sql`select to_regclass('featherbase.engine_invalid_binding') as relation`).toEqual([{ relation: null }])
    })
  }

  test('rejects malformed opaque naming on creation and update without changing the naming rule', async ({ admin }) => {
    await expect(admin.post('/api/table_def', {
      name: 'Engine Bad Opaque', id_pattern: 'opaque:UPPER_', columns: [{ column_name: 'title', column_type: 'Data' }],
    })).rejects.toMatchObject({ status: 417, fields: { id_pattern: expect.stringContaining('short lowercase prefix') } })
    expect(await sql`select name from table_def where name = 'Engine Bad Opaque'`).toEqual([])
    const table = await makeTable(admin, { name: 'Engine Opaque Guard', id_pattern: 'hash', columns: ['title'] })
    await expect(admin.put(`${table.defUrl}/id_pattern`, { id_pattern: 'opaque:a_' }))
      .rejects.toMatchObject({ status: 417, fields: { id_pattern: expect.stringContaining('short lowercase prefix') } })
    expect(await sql`select id_pattern from table_def where name = ${table.name}`).toEqual([{ id_pattern: 'hash' }])
  })

  test('accepts null optional flags on a read-modify-write and persists their defaults', async ({ admin }) => {
    const flags = { reqd: null, unique: null, read_only: null, hidden: null, in_list_view: null, tier: null }
    const meta = await admin.post<{ columns: Record<string, unknown>[] }>('/api/table_def', {
      name: 'Engine Null Flags', kind: null, is_submittable: null, system: null, decides_scope: null,
      columns: [{ column_name: 'title', column_type: 'Data', ...flags }],
    })
    expect(meta.columns[0]).toMatchObject({ reqd: false, unique: false, read_only: false, hidden: false, in_list_view: false, tier: 'basic' })
    await admin.put('/api/table_def/Engine%20Null%20Flags', {
      kind: null, is_submittable: null, system: null, decides_scope: null,
      columns: [{ ...meta.columns[0], ...flags }],
    })
    expect(await sql`select kind, is_submittable, system, decides_scope from table_def where name = 'Engine Null Flags'`)
      .toEqual([{ kind: 'table', is_submittable: false, system: false, decides_scope: false }])
    expect(await sql`select reqd, "unique", read_only, hidden, in_list_view, tier from column_def where parent = 'Engine Null Flags'`)
      .toEqual([{ reqd: false, unique: false, read_only: false, hidden: false, in_list_view: false, tier: 'basic' }])
  })

  test('refuses changing kind and retains the existing rows and schema', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Engine Kind Guard', columns: ['title'] })
    const row = await admin.post<{ row_id: string }>(table.url, { title: 'keep me' })
    await expect(admin.put(table.defUrl, { kind: 'settings', columns: [{ column_name: 'title', column_type: 'Data' }] }))
      .rejects.toMatchObject({ status: 417, type: 'ValidationError', message: expect.stringContaining('kind cannot be changed after creation') })
    expect(await admin.get(table.rowUrl(row.row_id))).toMatchObject({ row_id: row.row_id, title: 'keep me' })
    expect(await sql`select kind from table_def where name = ${table.name}`).toEqual([{ kind: 'table' }])
  })

  test('refuses renaming into a standard column without losing either value', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Engine Rename Guard', columns: ['title'] })
    const row = await admin.post<{ row_id: string }>(table.url, { title: 'preserved' })
    await expect(admin.post(`${table.defUrl}/rename_column`, { from: 'title', to: 'row_id' }))
      .rejects.toMatchObject({ status: 417, type: 'ValidationError', message: expect.stringContaining('row_id is a standard column name') })
    expect(await admin.get(table.rowUrl(row.row_id))).toMatchObject({ row_id: row.row_id, title: 'preserved' })
    expect(await sql`select column_name from column_def where parent = ${table.name}`).toEqual([{ column_name: 'title' }])
  })

  test('refuses renaming a system Table column before changing its definition', async ({ admin }) => {
    await expect(admin.post('/api/table_def/Person/rename_column', { from: 'email', to: 'renamed_email' }))
      .rejects.toMatchObject({ status: 417, type: 'ValidationError', message: expect.stringContaining('Person is a system table and cannot be changed') })
    expect(await sql`select column_name from column_def where parent = 'Person' and column_name in ('email', 'renamed_email')`)
      .toEqual([{ column_name: 'email' }])
  })
})

describe('Exported Table APIs enforce app and type boundaries', () => {
  test('rejects app-qualified creation by the wrong owner and noncollection app storage', async () => {
    await expect(createTable({ name: 'engineguard.item', columns: [{ column_name: 'title', column_type: 'Data' }] }, 'anotherapp'))
      .rejects.toMatchObject({ type: 'ValidationError', message: 'App-qualified Tables must be created by their owning app' })
    for (const binding of [{ kind: 'settings' }, { data_source: 'Engine Missing Source' }]) {
      await expect(createTable({ name: 'engineguard.item', columns: [{ column_name: 'title', column_type: 'Data' }], ...binding }, 'engineguard'))
        .rejects.toMatchObject({ type: 'ValidationError', message: 'Runtime app Tables require local collection storage' })
    }
    expect(await sql`select name from table_def where name = 'engineguard.item'`).toEqual([])
    expect(await sql`select schema_name from information_schema.schemata where schema_name = 'engineguard'`).toEqual([])
  })

  test('reports a missing stored relation through the public lookup', async () => {
    await expect(storedRelation('Engine Missing Table'))
      .rejects.toMatchObject({ type: 'NotFoundError', message: 'Table Engine Missing Table not found' })
  })

  test('refuses unsafe and missing type changes, and treats the current type as a no-op', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Engine Type Guard', columns: ['title'] })
    const row = await admin.post<{ row_id: string }>(table.url, { title: 'not a number' })
    await expect(changeColumnType(table.name, 'missing', 'Int'))
      .rejects.toMatchObject({ type: 'NotFoundError', message: 'Engine Type Guard has no column missing' })
    await expect(changeColumnType(table.name, 'title', 'Int'))
      .rejects.toMatchObject({ type: 'ValidationError', message: expect.stringContaining('Data to Int is not a safe conversion') })
    expect((await changeColumnType(table.name, 'title', 'Data')).columns.map(c => [c.column_name, c.column_type]))
      .toEqual([['title', 'Data']])
    expect(await admin.get(table.rowUrl(row.row_id))).toMatchObject({ title: 'not a number' })
    expect(await sql`select column_type from column_def where parent = ${table.name} and column_name = 'title'`).toEqual([{ column_type: 'Data' }])
  })

  test('refuses system-table type changes before touching metadata', async () => {
    await expect(changeColumnType('Person', 'email', 'Text'))
      .rejects.toMatchObject({ type: 'ValidationError', message: "Person's column types are not changed here" })
    expect(await sql`select column_type from column_def where parent = 'Person' and column_name = 'email'`).toEqual([{ column_type: 'Data' }])
  })

  test('rejects another app name and foreign app links before renaming storage', async () => {
    await provisionApp('engineguard', async () => {
      await createTable({ name: 'engineguard.item', columns: [{ column_name: 'title', column_type: 'Data' }] }, 'engineguard')
      await expect(renameTable('engineguard.item', 'anotherapp.item', 'engineguard'))
        .rejects.toMatchObject({ type: 'ValidationError', message: "anotherapp.item is not a name for one of engineguard's Tables" })
      await provisionApp('engineother', () => createTable({ name: 'engineother.link', columns: [
        { column_name: 'item', column_type: 'Reference', reference_table: 'engineguard.item' },
      ] }, 'engineother'))
      await expect(renameTable('engineguard.item', 'engineguard.renamed', 'engineguard'))
        .rejects.toMatchObject({ type: 'ValidationError', message: "engineguard.item is linked from another app's engineother.link.item" })
      expect(await sql`select name, physical_relation from table_def where owner_app = 'engineguard'`).toEqual([{ name: 'engineguard.item', physical_relation: 'item' }])
      expect(await sql`select to_regclass('engineguard.item') as original, to_regclass('engineguard.renamed') as renamed`)
        .toEqual([{ original: 'engineguard.item', renamed: null }])
    })
  })

  test('refuses an app-scoped drop of a platform Table and keeps its data', async ({ admin }) => {
    const table = await makeTable(admin, { name: 'Engine Owner Guard', columns: ['title'] })
    const row = await admin.post<{ row_id: string }>(table.url, { title: 'kept' })
    await expect(deleteTable(table.name, 'Administrator', { ownerApp: 'engineguard' }))
      .rejects.toMatchObject({ type: 'ValidationError', message: 'Engine Owner Guard belongs to the platform; only its own app drops it' })
    expect(await admin.get(table.rowUrl(row.row_id))).toMatchObject({ title: 'kept' })
  })
})
