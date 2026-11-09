import { describe, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
import { expectRefused, expectStatus, makeTable } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'
import { readFileSync } from 'node:fs'
import { sql } from '../src/db'
import { deleteTable } from '../src/table-engine'

const SERIES_DT = 'Nm Invoice'
const FIELD_DT = 'Nm Country'
const PROMPT_DT = 'Nm Category'

const makeDT = (admin: TestClient, name: string, id_pattern: string) =>
  makeTable(admin, { name, id_pattern, columns: ['title'] })

const save = (admin: TestClient, table: string, row: Record<string, unknown>) =>
  admin.post<{ row_id: string } & Record<string, unknown>>('/api/save_row', { table, row })

describe('META-006: naming rules', () => {
  test('#234 id_pattern HTTP accepts all supported shapes without changing schema or existing IDs', async ({ admin }) => {
    const table = 'Pattern Endpoint'
    await makeDT(admin, table, 'hash')
    const original = await save(admin, table, { title: 'original' })
    const schema = await sql`select column_name, data_type from information_schema.columns where table_name = 'pattern_endpoint' order by ordinal_position`
    const columns = await sql`select * from column_def where parent = ${table} order by position`
    for (const [pattern, input, expected] of [
      ['hash', { title: 'random' }, /^[0-9a-f]{10}$/],
      ['integer', { title: 'numbered' }, /^1$/],
      ['prompt', { row_id: 'Chosen ID', title: 'chosen' }, /^Chosen ID$/],
      ['ENDPOINT-.###', { title: 'series' }, /^ENDPOINT-001$/],
      ['field:title', { title: 'Field ID' }, /^Field ID$/],
    ] as const) {
      const response = await admin.fetch('/api/table_def/Pattern%20Endpoint/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: pattern }) })
      await expectStatus(response, 200)
      expect(await response.json()).toMatchObject({ id_pattern: pattern })
      expect((await save(admin, table, input)).row_id).toMatch(expected)
      expect(await admin.get(`/api/table/Pattern%20Endpoint/${original.row_id}`)).toMatchObject(original)
      expect(await sql`select * from column_def where parent = ${table} order by position`).toEqual(columns)
      expect(await sql`select column_name, data_type from information_schema.columns where table_name = 'pattern_endpoint' order by ordinal_position`).toEqual(schema)
    }
  })

  test('#234 malformed patterns and non-manager requests leave metadata unchanged', async ({ admin, createUser }) => {
    const table = 'Pattern Refusal'
    await makeDT(admin, table, 'hash')
    const before = await admin.get('/api/table/Pattern%20Refusal:meta')
    for (const pattern of [undefined, null, 42, '', 'PREFIX-', '.###', 'P-.##x', 'field:', 'field:missing']) {
      const res = await admin.fetch('/api/table_def/Pattern%20Refusal/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: pattern }) })
      await expectStatus(res, 417)
      expect(await res.json()).toMatchObject({ error: { type: 'ValidationError' } })
      expect(await admin.get('/api/table/Pattern%20Refusal:meta')).toEqual(before)
    }
    const user = await createUser()
    const denied = await user.fetch('/api/table_def/Pattern%20Refusal/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: 'NO-.###' }) })
    await expectStatus(denied, 403)
    expect(await admin.get('/api/table/Pattern%20Refusal:meta')).toEqual(before)
  })

  // Real root transactions, not a shared-session sandbox whose dispatcher
  // must serialize requests. Keep the numbering concurrency promise genuine.
  committedTest('50 parallel series inserts produce distinct gapless sequential names', async ({ admin }) => {
    const prefix = `NMINV${randomUUID().replaceAll('-', '')}-`
    await makeDT(admin, SERIES_DT, `${prefix}.####`)
    const pending = Array.from({ length: 50 }, (_, i) => save(admin, SERIES_DT, { title: `t${i}` }))
    try {
      const names = (await Promise.all(pending)).map(r => r.row_id)
      expect(new Set(names).size).toBe(50)
      const nums = names.map(n => Number(n.slice(prefix.length))).sort((a, b) => a - b)
      expect(nums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
      expect(names.every(name => name.startsWith(prefix))).toBe(true)
      expect(names[0].slice(prefix.length)).toMatch(/^\d{4}$/)
    } finally {
      await Promise.allSettled(pending)
      await deleteTable(SERIES_DT)
      await sql`delete from series where name = ${prefix}`
    }
  })

  test('field: naming uses the field value and requires it', async ({ admin }) => {
    await makeDT(admin, FIELD_DT, 'field:title')
    const doc = await save(admin, FIELD_DT, { title: 'India' })
    expect(doc.row_id).toBe('India')
    await expectRefused(save(admin, FIELD_DT, {}), 417)
  })

  test('prompt naming inserts with the client-provided name and requires it', async ({
    admin,
  }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    const doc = await save(admin, PROMPT_DT, { row_id: 'Hardware', title: 'x' })
    expect(doc.row_id).toBe('Hardware')
    await expectRefused(save(admin, PROMPT_DT, { title: 'y' }), 417)
  })

  test('prompt naming updates the existing doc when the name already exists', async ({
    admin,
  }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    const first = await save(admin, PROMPT_DT, { row_id: 'Software', title: 'v1' })
    await save(admin, PROMPT_DT, {
      row_id: 'Software',
      updated_at: first.updated_at,
      title: 'v2',
    })
    const [row] = await sql.unsafe(`select title from featherbase.nm_category where row_id='Software'`)
    expect(row.title).toBe('v2')
  })
})

describe('A series never reuses a number', () => {
  test('deleting the newest row and adding another continues after it', async ({ admin }) => {
    await makeDT(admin, 'Nm Reuse', 'NMRU-.####')
    const rows = []
    for (const title of ['a', 'b', 'c', 'd', 'e']) rows.push(await save(admin, 'Nm Reuse', { title }))
    expect(rows.at(-1)!.row_id).toBe('NMRU-0005')
    await admin.delete(`/api/table/Nm%20Reuse/NMRU-0005`)
    const next = await save(admin, 'Nm Reuse', { title: 'f' })
    expect(next.row_id).toBe('NMRU-0006')
  })
})

describe('A typed-in name must be unique', () => {
  test('creating a row under a name already in use is refused and the existing row is untouched', async ({ admin }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    await save(admin, PROMPT_DT, { row_id: 'Tools', title: 'original' })
    // The explicit create path refuses outright...
    await expect(
      admin.post(`/api/table/${encodeURIComponent(PROMPT_DT)}`, { row_id: 'Tools', title: 'imposter' }),
    ).rejects.toMatchObject({ status: 409 })
    // ...and the form's save path, which carries no loaded version for a new row, refuses too.
    await expectRefused(save(admin, PROMPT_DT, { row_id: 'Tools', title: 'imposter' }), 417)
    const row = await admin.get<{ title: string }>(`/api/table/${encodeURIComponent(PROMPT_DT)}/Tools`)
    expect(row.title).toBe('original')
  })
})

describe("A name that comes from the row can't be left out", () => {
  test('a row named after its own column is refused without it, calling the column out', async ({ admin }) => {
    await makeTable(admin, { name: FIELD_DT, id_pattern: 'field:country', columns: ['country'] })
    await expect(save(admin, FIELD_DT, {})).rejects.toMatchObject({ status: 417, fields: { country: expect.any(String) } })
    expect(await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(FIELD_DT)}:count`)).toEqual({ count: 0 })
  })

  test('a typed-in name is required', async ({ admin }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    await expect(save(admin, PROMPT_DT, { title: 'no id' })).rejects.toMatchObject({ status: 417, fields: { row_id: expect.any(String) } })
  })
})

// #855: new Tables number rows 1, 2, 3, each Table keeps its own count, and a
// number already in the Table is skipped.
describe('#855: plain numbers and a count per Table', () => {
  test('a Table created without a naming rule numbers its rows 1, 2, 3', async ({ admin }) => {
    await makeTable(admin, { name: 'Nm Plant', columns: ['title'] })
    expect(await admin.get('/api/table/Nm%20Plant:meta')).toMatchObject({ id_pattern: 'integer' })
    const ids = []
    for (const title of ['a', 'b', 'c']) ids.push((await save(admin, 'Nm Plant', { title })).row_id)
    expect(ids).toEqual(['1', '2', '3'])
  })

  test('a child Table created without a naming rule keeps random ids', async ({ admin }) => {
    await makeTable(admin, { name: 'Nm Plant Line', kind: 'sub_table', columns: ['title'] })
    expect(await admin.get('/api/table/Nm%20Plant%20Line:meta')).toMatchObject({ id_pattern: 'hash' })
  })

  test('two Tables with the same series prefix each start at 001', async ({ admin }) => {
    await makeDT(admin, 'Nm Store', 'NMSTORE-.###')
    await makeDT(admin, 'Nm Store Copy', 'NMSTORE-.###')
    expect((await save(admin, 'Nm Store', { title: 'a' })).row_id).toBe('NMSTORE-001')
    expect((await save(admin, 'Nm Store Copy', { title: 'a' })).row_id).toBe('NMSTORE-001')
    expect((await save(admin, 'Nm Store', { title: 'b' })).row_id).toBe('NMSTORE-002')
  })

  test('a number already used by a supplied id is skipped, for integers and series', async ({ admin }) => {
    await makeDT(admin, 'Nm Bin', 'integer')
    await makeDT(admin, 'Nm Shelf', 'NMSHELF-.##')
    expect((await save(admin, 'Nm Bin', { title: 'a' })).row_id).toBe('1')
    await admin.post('/api/table/Nm%20Bin', { row_id: '2', title: 'imported' })
    await admin.post('/api/table/Nm%20Bin', { row_id: '3', title: 'imported' })
    expect((await save(admin, 'Nm Bin', { title: 'b' })).row_id).toBe('4')
    await admin.post('/api/table/Nm%20Shelf', { row_id: 'NMSHELF-01', title: 'imported' })
    expect((await save(admin, 'Nm Shelf', { title: 'a' })).row_id).toBe('NMSHELF-02')
  })

  test('a deleted and recreated Table carries on its count', async ({ admin }) => {
    await makeDT(admin, 'Nm Gone', 'integer')
    await save(admin, 'Nm Gone', { title: 'a' })
    await save(admin, 'Nm Gone', { title: 'b' })
    await admin.delete('/api/table_def/Nm%20Gone')
    await makeDT(admin, 'Nm Gone', 'integer')
    expect((await save(admin, 'Nm Gone', { title: 'c' })).row_id).toBe('3')
  })
})

describe('#855: the per-Table counter migration', () => {
  const migration = readFileSync(new URL('../migrations/0014_series_per_table.sql', import.meta.url), 'utf8')

  test('a Table numbered before the upgrade carries on from its prefix count', async ({ admin }) => {
    await makeDT(admin, 'Nm Legacy', 'NMLEG-.###')
    await makeDT(admin, 'Nm Legacy Copy', 'NMLEG-.###')
    await makeTable(admin, { name: 'Nm Legacy Child', kind: 'sub_table', columns: ['title'] })
    // The state an instance is in before the upgrade: one count per prefix.
    await sql`insert into series (name, current) values ('NMLEG-', 61)`
    await sql.unsafe(migration)
    await sql.unsafe(migration) // repeatable
    expect((await save(admin, 'Nm Legacy', { title: 'a' })).row_id).toBe('NMLEG-062')
    expect((await save(admin, 'Nm Legacy Copy', { title: 'a' })).row_id).toBe('NMLEG-062')
    expect(await sql`select name from series where starts_with(name, 'table:Nm Legacy Child:')`).toEqual([])
  })

  test('a Table that used another prefix before the upgrade never reissues its numbers', async ({ admin }) => {
    // Issued NMOLD-001 and NMOLD-002, deleted both, then switched to NMNEW-.
    await makeDT(admin, 'Nm Switched', 'NMNEW-.###')
    await sql`insert into series (name, current) values ('NMOLD-', 2)`
    await sql.unsafe(migration)
    await admin.fetch('/api/table_def/Nm%20Switched/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: 'NMOLD-.###' }) })
    expect((await save(admin, 'Nm Switched', { title: 'a' })).row_id).toBe('NMOLD-003')
  })
})

// #858: fixed text plus one column, e.g. PLANT-8151 from plant_code 8151.
describe('#858: a fixed prefix plus a column', () => {
  const PLANT = 'Nm Plant Master'
  const plant = (admin: TestClient) =>
    makeTable(admin, { name: PLANT, id_pattern: 'PLANT-{plant_code}', columns: ['plant_code', 'title'] })
  const at = (id: string) => `/api/table/${encodeURIComponent(PLANT)}/${encodeURIComponent(id)}`

  test('a new row is named by the prefix and the column, by form, API and import alike', async ({ admin }) => {
    await plant(admin)
    expect((await save(admin, PLANT, { plant_code: '8151', title: 'Chennai' })).row_id).toBe('PLANT-8151')
    // POST /api/table is the create path imports and API clients use.
    expect((await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(PLANT)}`, { plant_code: '8152' })).row_id).toBe('PLANT-8152')
  })

  test('the column is required, and is called out when blank', async ({ admin }) => {
    await plant(admin)
    await expect(save(admin, PLANT, { title: 'no code' })).rejects.toMatchObject({ status: 417, fields: { plant_code: expect.any(String) } })
    expect(await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(PLANT)}:count`)).toEqual({ count: 0 })
  })

  test('a second row with the same code is refused, naming the column, and the first is untouched', async ({ admin }) => {
    await plant(admin)
    await save(admin, PLANT, { plant_code: '8151', title: 'Chennai' })
    for (const attempt of [
      () => save(admin, PLANT, { plant_code: '8151', title: 'Madurai' }),
      () => admin.post(`/api/table/${encodeURIComponent(PLANT)}`, { plant_code: '8151', title: 'Madurai' }),
    ])
      await expect(attempt()).rejects.toMatchObject({
        status: 417,
        message: expect.stringContaining('plant_code 8151'),
        fields: { plant_code: expect.stringContaining('PLANT-8151') },
      })
    expect(await admin.get(at('PLANT-8151'))).toMatchObject({ title: 'Chennai' })
  })

  test('a duplicate value of a plain column-named Table is refused the same way', async ({ admin }) => {
    await makeTable(admin, { name: FIELD_DT, id_pattern: 'field:country', columns: ['country'] })
    await save(admin, FIELD_DT, { country: 'India' })
    await expect(save(admin, FIELD_DT, { country: 'India' })).rejects.toMatchObject({
      status: 417,
      fields: { country: expect.stringContaining('India') },
    })
  })

  test('changing the column later keeps the id; Rename moves it', async ({ admin }) => {
    await plant(admin)
    const row = await save(admin, PLANT, { plant_code: '8151', title: 'Chennai' })
    const edited = await save(admin, PLANT, { row_id: 'PLANT-8151', updated_at: row.updated_at, plant_code: '8159' })
    expect(edited).toMatchObject({ row_id: 'PLANT-8151', plant_code: '8159' })
    await admin.post(`${at('PLANT-8151')}:rename`, { new_name: 'PLANT-8159' })
    expect(await admin.get(at('PLANT-8159'))).toMatchObject({ plant_code: '8159', title: 'Chennai' })
  })

  test('an import check flags a code already naming a plant, repeated in the file, or missing', async ({ admin }) => {
    await plant(admin)
    await save(admin, PLANT, { plant_code: '8151', title: 'Chennai' })
    const report = await admin.post<{ failed: { index: number; message: string }[] }>(
      `/api/table/${encodeURIComponent(PLANT)}:import`,
      { dry_run: true, rows: [{ plant_code: '8151' }, { plant_code: '8152' }, { plant_code: '8152' }, { title: 'no code' }] },
    )
    expect(report.failed.map((f) => f.index)).toEqual([0, 2, 3])
    expect(report.failed[0].message).toContain('PLANT-8151')
  })

  test('the rule is accepted for a real column only', async ({ admin }) => {
    await makeDT(admin, 'Nm Rule Check', 'hash')
    const put = (id_pattern: string) =>
      admin.fetch('/api/table_def/Nm%20Rule%20Check/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern }) })
    await expectStatus(await put('PLANT-{title}'), 200)
    for (const bad of ['PLANT-{missing}', 'PLANT-{title', '{title}', 'A-{title}-B', 'A-{title}{title}', 'PLANT {title}', ' P-{title}'])
      await expectStatus(await put(bad), 417)
  })

  test('renaming the column carries the rule with it', async ({ admin }) => {
    await plant(admin)
    await admin.post(`/api/table_def/${encodeURIComponent(PLANT)}/rename_column`, { from: 'plant_code', to: 'sap_code' })
    expect(await admin.get(`/api/table/${encodeURIComponent(PLANT)}:meta`)).toMatchObject({ id_pattern: 'PLANT-{sap_code}' })
    expect((await save(admin, PLANT, { sap_code: '8151' })).row_id).toBe('PLANT-8151')
  })
})
