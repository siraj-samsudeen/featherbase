// The mysql engine joins the Data Source choices (driver: mysql-driver.ts).
// Metadata-only: the engine Choice column and the Table description learn the
// new option; no physical schema changes. Idempotent like 0030's choice edit.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  await sql`
    update column_def set choices = ${'postgres\nmysql\nduckdb\ncsv-folder'}
    where parent = 'Data Source' and column_name = 'engine'
      and choices not like '%mysql%'`
  await sql`
    update table_def set description = ${
      'A connection to an external store (Postgres, MySQL, DuckDB/MotherDuck, or a CSV folder). ' +
      'Credentials are read from the named environment variable at connect time and are never stored. ' +
      'For read-only access, prefer a database role/token that is itself read-only — the access flag here is a guard rail, not the security boundary.'
    }
    where name = 'Data Source'`
  invalidateMeta('Data Source')
}
