import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { makeTable } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

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
      ['prompt', { row_id: 'Chosen ID', title: 'chosen' }, /^Chosen ID$/],
      ['ENDPOINT-.###', { title: 'series' }, /^ENDPOINT-001$/],
      ['field:title', { title: 'Field ID' }, /^Field ID$/],
    ] as const) {
      const response = await admin.fetch('/api/table_def/Pattern%20Endpoint/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: pattern }) })
      expect(response.status).toBe(200)
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
      expect(res.status).toBe(417)
      expect(await res.json()).toMatchObject({ error: { type: 'ValidationError' } })
      expect(await admin.get('/api/table/Pattern%20Refusal:meta')).toEqual(before)
    }
    const user = await createUser()
    const denied = await user.fetch('/api/table_def/Pattern%20Refusal/id_pattern', { method: 'PUT', body: JSON.stringify({ id_pattern: 'NO-.###' }) })
    expect(denied.status).toBe(403)
    expect(await admin.get('/api/table/Pattern%20Refusal:meta')).toEqual(before)
  })

  test('50 parallel series inserts produce distinct gapless sequential names', async ({
    admin,
  }) => {
    await makeDT(admin, SERIES_DT, 'NMINV-.####')
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => save(admin, SERIES_DT, { title: `t${i}` })),
    )
    const names = results.map((r) => r.row_id)
    expect(new Set(names).size).toBe(50)
    const nums = names.map((n) => Number(n.replace('NMINV-', ''))).sort((a, b) => a - b)
    expect(nums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(names[0]).toMatch(/^NMINV-\d{4}$/)
  })

  test('field: naming uses the field value and requires it', async ({ admin }) => {
    await makeDT(admin, FIELD_DT, 'field:title')
    const doc = await save(admin, FIELD_DT, { title: 'India' })
    expect(doc.row_id).toBe('India')
    await expect(save(admin, FIELD_DT, {})).rejects.toMatchObject({ status: 417 })
  })

  test('prompt naming inserts with the client-provided name and requires it', async ({
    admin,
  }) => {
    await makeDT(admin, PROMPT_DT, 'prompt')
    const doc = await save(admin, PROMPT_DT, { row_id: 'Hardware', title: 'x' })
    expect(doc.row_id).toBe('Hardware')
    await expect(save(admin, PROMPT_DT, { title: 'y' })).rejects.toMatchObject({ status: 417 })
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
    const [row] = await sql.unsafe(`select title from nm_category where row_id='Software'`)
    expect(row.title).toBe('v2')
  })
})
