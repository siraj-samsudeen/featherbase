// EDS-1/EDS-3 (spec 0001, milestone M3): the Data Source registry and the
// table_def/column_def binding fields for source-bound Tables.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'

export async function up() {
  await sql.unsafe(`
    alter table table_def
      add column if not exists data_source varchar(140),
      add column if not exists external_schema text,
      add column if not exists external_table text,
      add column if not exists external_pk text,
      add column if not exists external_modified text`)
  await sql.unsafe(`
    alter table column_def add column if not exists source_column text`)
  invalidateMeta()

  const [exists] = await sql`select 1 from table_def where name = 'Data Source'`
  if (!exists) {
    await createTable({
      name: 'Data Source',
      module: 'Integrations',
      system: true,
      id_pattern: 'prompt',
      description:
        'A connection to an external store (Postgres, DuckDB/MotherDuck, or a CSV folder). ' +
        'Credentials are read from the named environment variable at connect time and are never stored. ' +
        'For read-only access, prefer a database role/token that is itself read-only — the access flag here is a guard rail, not the security boundary.',
      columns: [
        {
          column_name: 'engine',
          label: 'Engine',
          column_type: 'Choice',
          choices: 'postgres\nduckdb\ncsv-folder',
          reqd: true,
          in_list_view: true,
        },
        {
          column_name: 'url_env',
          label: 'Connection Env Var',
          column_type: 'Data',
          in_list_view: true,
        },
        {
          column_name: 'root_path',
          label: 'Root Path (csv-folder)',
          column_type: 'Data',
        },
        { column_name: 'default_schema', label: 'Default Schema', column_type: 'Data' },
        {
          column_name: 'access',
          label: 'Access',
          column_type: 'Choice',
          choices: 'read_only\nread_write',
          default_value: 'read_only',
          reqd: true,
          in_list_view: true,
        },
        { column_name: 'pool_max', label: 'Pool Max', column_type: 'Int', default_value: '5' },
        {
          column_name: 'statement_timeout_ms',
          label: 'Statement Timeout (ms)',
          column_type: 'Int',
          default_value: '10000',
        },
        { column_name: 'table_allowlist', label: 'Table Allowlist', column_type: 'Long Text' },
        {
          column_name: 'conn_status',
          label: 'Connection Status',
          column_type: 'Choice',
          choices: 'untested\nok\nerror',
          default_value: 'untested',
          read_only: true,
          in_list_view: true,
        },
        {
          column_name: 'last_checked_at',
          label: 'Last Checked At',
          column_type: 'Datetime',
          read_only: true,
        },
        { column_name: 'last_error', label: 'Last Error', column_type: 'Long Text', read_only: true },
      ],
    })
  }
}
