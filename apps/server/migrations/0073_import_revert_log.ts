// RVT-R1 (spec 0005): a run becomes addressable. The Import Log learns the
// run_id its parts share, the rows each part wrote (id + action + the
// updated_at stamp the write left + the version row an update produced),
// and when the run was reverted. Converges existing databases; fresh
// installs get the shape from the rewritten 0056.
//
// Numbering note: 0070/0071 were claimed by parallel PRs (#127, #137), and
// 0072 landed unannounced with #152 (mysql engine) — hence 0073.
import { sql } from '../src/db'
import { tableName } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'

const NEW_COLUMNS = [
  { column_name: 'run_id', label: 'Run', column_type: 'Data', pg: 'varchar(64)', in_list_view: false },
  { column_name: 'touched', label: 'Touched Rows', column_type: 'JSON', pg: 'jsonb', in_list_view: false, hidden: true },
  { column_name: 'reverted_at', label: 'Reverted At', column_type: 'Datetime', pg: 'timestamptz', in_list_view: true },
]

export async function up() {
  const [log] = await sql`select 1 from table_def where name = 'Import Log'`
  if (!log) return // 0056 not applied — a fresh install creates the full shape there

  const existing = await sql`select column_name from column_def where parent = 'Import Log'`
  const have = new Set(existing.map((r) => r.column_name as string))
  const [{ maxidx }] =
    await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Import Log'`
  let position = maxidx as number

  for (const col of NEW_COLUMNS) {
    if (have.has(col.column_name)) continue
    position += 1
    await sql`insert into column_def ${sql({
      parent: 'Import Log',
      position,
      column_name: col.column_name,
      label: col.label,
      column_type: col.column_type,
      choices: null,
      reqd: false,
      unique: false,
      read_only: false,
      hidden: col.hidden ?? false,
      in_list_view: col.in_list_view,
      tier: 'basic',
    })}`
    await sql.unsafe(
      `alter table "${tableName('Import Log')}" add column if not exists "${col.column_name}" ${col.pg}`,
    )
  }
  invalidateMeta('Import Log')
}
