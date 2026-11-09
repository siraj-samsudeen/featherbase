// A connected Postgres source of stores and their floors (#786), for the
// external-data-sources scenarios that explore one through the other. The
// outside rows live in the sibling database (external-database.ts), in a schema
// of the caller's own so the server and web suites never share one; the Tables
// are made in the test's sandbox.
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'

export const EXPLORE_STORE = 'Explore Source Store'
export const EXPLORE_FLOOR = 'Explore Source Floor'

/** North with two floors, South with one and Empty with none; one floor on no store and one on a store that is gone. */
export async function exploreSource(admin: TestClient, schema: string) {
  const env = `${schema.toUpperCase()}_SOURCE_URL`
  process.env[env] = EXTERNAL_DATABASE_URL
  const db = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await db.unsafe(`drop schema if exists ${schema} cascade;
      create schema ${schema};
      create table ${schema}.store (code int primary key, label text);
      create table ${schema}.floor (code int primary key, label text, store_id int);
      insert into ${schema}.store values (11,'North'),(29,'South'),(47,'Empty');
      insert into ${schema}.floor values (101,'North one',11),(103,'North two',11),
        (211,'South only',29),(307,'Unlinked',null),(401,'Orphan',9999);`)
  } finally { await db.end({ timeout: 2 }) }
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: `${schema.replaceAll('_', '-')}-source`, engine: 'postgres', access: 'read_only', url_env: env })
  for (const [name, relation, columns] of [
    [EXPLORE_STORE, 'store', [{ column_name: 'label', column_type: 'Data' }]],
    [EXPLORE_FLOOR, 'floor', [{ column_name: 'label', column_type: 'Data' },
      { column_name: 'store', column_type: 'Reference', reference_table: EXPLORE_STORE, source_column: 'store_id' }]],
  ] as const) await admin.post('/api/table_def', {
    name, title_column: 'label', data_source: `${schema.replaceAll('_', '-')}-source`, external_schema: schema,
    external_table: relation, external_pk: 'code', columns,
  })
}

/** More than five hundred stores, the last of them with a floor. */
export async function manyStores(schema: string) {
  const db = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await db.unsafe(`insert into ${schema}.store select n, 'Bulk ' || n from generate_series(1000,1600) n;
      insert into ${schema}.floor values (601,'Last store',1600);`)
  } finally { await db.end({ timeout: 2 }) }
}

export async function dropExploreSource(schema: string) {
  invalidateSources()
  const db = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  try { await db.unsafe(`drop schema if exists ${schema} cascade`) } finally { await db.end({ timeout: 2 }) }
}
