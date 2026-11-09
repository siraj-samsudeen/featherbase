// Source rows must commit: the driver's independent pool cannot see the
// platform sandbox. Only this file's synthetic schema is dropped afterwards.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { expectRefused, expectStatus, grantRole } from './fixtures'
import { config } from '../src/config'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { invalidateSources } from '../src/sources/registry'

const SCHEMA = 'related_786'
const REGION = 'Related Region'
const STORE = 'Related Store'
const FLOOR = 'Related Floor'
let external: ReturnType<typeof postgres>

beforeAll(async () => {
  process.env.RELATED_786_URL = EXTERNAL_DATABASE_URL
  external = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await external.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.region (code int primary key, label text);
    create table ${SCHEMA}.store (code int primary key, label text, region_id int);
    create table ${SCHEMA}.floor (code int primary key, label text, store_id int, kind text);
    insert into ${SCHEMA}.region values (5,'East'),(8,'West');
    insert into ${SCHEMA}.store values (11,'North',5),(29,'South',8),(47,'Empty',5);
    insert into ${SCHEMA}.store select n, 'Bulk ' || n, 8 from generate_series(1000,1600) n;
    insert into ${SCHEMA}.floor values
      (101,'North one',11,'small'),(103,'North two',11,'large'),
      (211,'South only',29,'small'),(307,'Unlinked',null,'large'),
      (401,'Orphan',9999,'small'),(601,'Last store',1600,'large');`)
})

afterAll(async () => {
  if (external) {
    await external.unsafe(`drop schema ${SCHEMA} cascade`)
    await external.end()
  }
  delete process.env.RELATED_786_URL
})

async function connect(admin: TestClient) {
  await admin.post('/api/table/Data%20Source', {
    row_id: 'related-786', engine: 'postgres', url_env: 'RELATED_786_URL', access: 'read_only',
  })
  for (const [name, relation, columns] of [
    [REGION, 'region', [{ column_name: 'label', column_type: 'Data' }]],
    [STORE, 'store', [
      { column_name: 'label', column_type: 'Data' },
      { column_name: 'region', column_type: 'Reference', reference_table: REGION, source_column: 'region_id' },
    ]],
    [FLOOR, 'floor', [
      { column_name: 'label', column_type: 'Data' },
      { column_name: 'store', column_type: 'Reference', reference_table: STORE, source_column: 'store_id' },
      { column_name: 'kind', column_type: 'Data' },
    ]],
  ] as const) {
    await admin.post('/api/table_def', {
      name, data_source: 'related-786', external_schema: SCHEMA,
      external_table: relation, external_pk: 'code', columns,
    })
  }
}

type Filters = [string, string, unknown][]
const related = (filters: Filters = []): Filters => [['store', 'related', { table: STORE, filters }]]
const nested = (): Filters => related([['region', 'related', { table: REGION, filters: [['label', '=', 'East']] }]])
const query = (filters: Filters) => new URLSearchParams({ filters: JSON.stringify(filters) })
const path = `/api/table/${encodeURIComponent(FLOOR)}`

describe('same-source PostgreSQL relationship membership', () => {
  test('refuses a non-array filter payload without returning source rows', async ({ admin }) => {
    await connect(admin)
    const malformed = new URLSearchParams({ filters: JSON.stringify({ store: '11' }) })
    for (const endpoint of [path, `${path}:count`]) {
      const response = await admin.fetch(`${endpoint}?${malformed}`)
      await expectStatus(response, 417)
      expect(await response.json()).toEqual({
        error: { type: 'ValidationError', message: 'filters must be an array of [field, operator, value]' },
      })
    }
    expect(await admin.get(`${path}:count?${query(related())}`)).toEqual({ count: 4 })
  })

  test('matches the full upstream set rather than a displayed page', async ({ admin }) => {
    await connect(admin)
    const filters = related()
    const result = await admin.get(`${path}?${query(filters)}&fields=["row_id","label"]&order_by=row_id%20asc&limit_page_length=2`)
    expect(result).toEqual({
      data: [{ row_id: '101', label: 'North one' }, { row_id: '103', label: 'North two' }],
      total: 4, limit_start: 0, limit_page_length: 2,
    })
    expect(await admin.get(`${path}:count?${query(filters)}`)).toEqual({ count: 4 })
    expect(await admin.get(`${path}:aggregate?${query(filters)}`)).toEqual({ count: 4, sum: null })
    expect(await admin.get(`${path}:summary?${query(filters)}&group_by=kind`)).toEqual({
      count: 4, sums: {}, groups: [
        { value: 'large', count: 2, sums: {} }, { value: 'small', count: 2, sums: {} },
      ],
    })
    expect(await admin.post('/api/dashboard/chart', { table: FLOOR, group_by: 'kind', filters })).toMatchObject({
      data: [{ label: 'large', value: 2 }, { label: 'small', value: 2 }],
    })
    expect(await admin.get(`${path}?${query(related([['row_id', '=', '1600']]))}`)).toMatchObject({ data: [{ row_id: '601' }], total: 1 })
  })

  test.for([
    ['North', ['101', '103']], ['South', ['211']], ['Missing', []], ['Empty', []],
  ] as const)('follows upstream filter %s', async ([label, ids], { admin }) => {
    await connect(admin)
    const filters = related([['label', '=', label]])
    const result = await admin.get<{ data: { row_id: string }[]; total: number }>(`${path}?${query(filters)}&order_by=row_id%20asc`)
    expect(result.data.map(r => r.row_id)).toEqual(ids)
    expect(result.total).toBe(ids.length)
    expect(await admin.get(`${path}:count?${query(filters)}`)).toEqual({ count: ids.length })
  })

  test('composes nested membership with distinct outer and sibling parameters', async ({ admin }) => {
    await connect(admin)
    const filters: Filters = [
      ['kind', '=', 'small'], ...nested(), ...related([['label', '!=', 'South']]), ['label', 'like', '%one'],
    ]
    expect(await admin.get(`${path}?${query(filters)}`)).toMatchObject({ data: [{ row_id: '101' }], total: 1 })
    expect(await admin.get(`${path}:summary?${query(filters)}&group_by=kind`)).toEqual({
      count: 1, sums: {}, groups: [{ value: 'small', count: 1, sums: {} }],
    })
  })

  test.for([STORE, REGION, FLOOR])('refuses unreadable participating table %s', async (denied, { admin, createUser }) => {
    await connect(admin)
    await grantRole(admin, { role: 'Related Reader', table: [STORE, REGION, FLOOR].filter(t => t !== denied), can_read: true })
    const user = await createUser({ email: 'related-denied@example.com', roles: ['Related Reader'] })
    await expect(user.get(`${path}?${query(nested())}`)).rejects.toMatchObject({ status: 403, type: 'PermissionError' })
  })

  test('refuses an own-rows-only intermediate grant', async ({ admin, createUser }) => {
    await connect(admin)
    await grantRole(admin, { role: 'Related Reader', table: [FLOOR, REGION], can_read: true })
    await grantRole(admin, { role: 'Related Reader', table: STORE, can_read: true, own_rows_only: true })
    const user = await createUser({ email: 'related-owned@example.com', roles: ['Related Reader'] })
    await expectRefused(user.get(`${path}?${query(nested())}`), 403, 'own-rows')
  })

  test.for([
    [STORE, '29', ['211']], [REGION, '5', ['101', '103']], [FLOOR, '103', ['103']],
  ] as const)('applies Data Scope at %s', async ([table, allowed, ids], { admin, createUser }) => {
    await connect(admin)
    await grantRole(admin, { role: 'Related Reader', table: [FLOOR, STORE, REGION], can_read: true })
    const user = await createUser({ email: 'related-scoped@example.com', roles: ['Related Reader'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: table, for_value: allowed } })
    const filters = related()
    const rows = await user.get<{ data: { row_id: string }[] }>(`${path}?${query(filters)}&order_by=row_id%20asc`)
    expect(rows.data.map(r => r.row_id)).toEqual(ids)
    expect(await user.get(`${path}:aggregate?${query(filters)}`)).toEqual({ count: ids.length, sum: null })
  })

  test.for([[FLOOR, 'store', related()], [STORE, 'region', nested()], [REGION, 'label', nested()]] as const)(
    'refuses a restricted caller filter at %s', async ([table, column, filters], { admin, createUser }) => {
      await connect(admin)
      await sql`update column_def set tier = 'restricted' where parent = ${table} and column_name = ${column}`
      invalidateMeta()
      await grantRole(admin, { role: 'Related Reader', table: [FLOOR, STORE, REGION], can_read: true })
      const user = await createUser({ email: 'related-tier@example.com', roles: ['Related Reader'] })
      await expectRefused(user.get(`${path}?${query(filters as Filters)}`), 417, 'Unknown filter field')
    },
  )

  test('scopes by a hidden intermediate Reference before narrowing tiers', async ({ admin, createUser }) => {
    await connect(admin)
    await sql`update column_def set tier = 'restricted' where parent = ${STORE} and column_name = 'region'`
    invalidateMeta()
    await grantRole(admin, { role: 'Related Reader', table: [FLOOR, STORE, REGION], can_read: true })
    const user = await createUser({ email: 'related-hidden-scope@example.com', roles: ['Related Reader'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: REGION, for_value: '5' } })
    expect(await user.get(`${path}?${query(related())}&order_by=row_id%20asc`)).toMatchObject({ data: [{ row_id: '101' }, { row_id: '103' }], total: 2 })
  })

  test('retains NULL-passes Data Scope without matching NULL relationships', async ({ admin, createUser }) => {
    await connect(admin)
    await grantRole(admin, { role: 'Related Reader', table: [FLOOR, STORE], can_read: true })
    const user = await createUser({ email: 'related-null@example.com', roles: ['Related Reader'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: STORE, for_value: '11' } })
    expect(await user.get(`${path}?order_by=row_id%20asc`)).toMatchObject({ data: [{ row_id: '101' }, { row_id: '103' }, { row_id: '307' }], total: 3 })
    expect(await user.get(`${path}?${query(related())}&order_by=row_id%20asc`)).toMatchObject({ data: [{ row_id: '101' }, { row_id: '103' }], total: 2 })
  })

  test.for([STORE, REGION])('refuses a different Data Source record at %s even with identical credentials', async (table, { admin }) => {
    await connect(admin)
    await admin.post('/api/table/Data%20Source', { row_id: 'related-other', engine: 'postgres', url_env: 'RELATED_786_URL' })
    await sql`update table_def set data_source = 'related-other' where name = ${table}`
    invalidateMeta()
    await expectRefused(admin.get(`${path}?${query(nested())}`), 417, 'same Data Source record')
  })

  test('retains the platform-database identity refusal for relationship reads', async ({ admin }) => {
    await connect(admin)
    process.env.RELATED_786_URL = config.databaseUrl
    invalidateSources()
    try {
      await expect(admin.get(`${path}?${query(related())}`)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("platform's own database") })
    } finally {
      process.env.RELATED_786_URL = EXTERNAL_DATABASE_URL
      invalidateSources()
    }
  })

  test.for(['via', 'parent', 'wrong-target', 'non-reference', 'native-target', 'non-postgres'])(
    'refuses unsupported relationship %s', async (shape, { admin }) => {
      await connect(admin)
      let filters = related()
      if (shape === 'via') filters = [['row_id', 'related', { table: STORE, via: 'Some Lines', column: 'store' }]]
      if (shape === 'parent') filters = [['parent', 'related', { table: STORE }]]
      if (shape === 'wrong-target') filters = [['store', 'related', { table: REGION }]]
      if (shape === 'non-reference') filters = [['label', 'related', { table: STORE }]]
      if (shape === 'native-target') {
        await sql`update table_def set data_source = null where name = ${STORE}`
        invalidateMeta()
      }
      if (shape === 'non-postgres') {
        await sql`update data_source set engine = 'duckdb' where row_id = 'related-786'`
        invalidateSources()
      }
      await expect(admin.get(`${path}?${query(filters)}`)).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
    },
  )

  test.for(['allowlist', 'platform-schema', 'sensitive-pk'])(
    'retains target binding guard %s', async (guard, { admin }) => {
      await connect(admin)
      if (guard === 'allowlist') {
        await sql`update data_source set table_allowlist = ${`${SCHEMA}.floor`} where row_id = 'related-786'`
        invalidateSources()
      } else {
        if (guard === 'platform-schema') await sql`update table_def set external_schema = 'featherbase' where name = ${STORE}`
        else await sql`update table_def set external_pk = 'password' where name = ${STORE}`
        invalidateMeta()
      }
      await expect(admin.get(`${path}?${query(related())}`)).rejects.toMatchObject({ status: guard === 'sensitive-pk' ? 417 : 403 })
    },
  )

  test('retains request-wide hop budgets at both sides of the boundary', async ({ admin }) => {
    await connect(admin)
    expect(await admin.get(`${path}:count?${query(Array.from({ length: 16 }, () => related()[0]))}`)).toEqual({ count: 4 })
    await expectRefused(admin.get(`${path}:count?${query(Array.from({ length: 17 }, () => related()[0]))}`), 417, '16')
    // Model a legal self-Reference using the same physical store key. Each
    // hop is valid, so only the recursion limit may refuse this request.
    await sql`update column_def set reference_table = ${STORE}, source_column = 'code' where parent = ${STORE} and column_name = 'region'`
    invalidateMeta()
    const self = (depth: number): Filters => depth ? [['region', 'related', { table: STORE, filters: self(depth - 1) }]] : [['label', '=', 'North']]
    expect(await admin.get(`${path}:count?${query(related(self(2)))}`)).toEqual({ count: 2 })
    await expectRefused(admin.get(`${path}:count?${query(related(self(3)))}`), 417, '3 levels')
  })
})
