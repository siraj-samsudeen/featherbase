// RPT-004: Query Reports — a Report can carry admin-authored SQL. Adds
// report_type (Report Builder | Query Report) and the query text. Idempotent:
// only inserts column_defs that are missing.
import { sql } from '../src/db'
import { pgType } from '../src/doctype-engine'

const NEW_COLUMNS = [
  { column_name: 'report_type', column_type: 'Choice', label: 'Report Type', choices: 'Report Builder\nQuery Report', default_value: 'Report Builder' },
  { column_name: 'query', column_type: 'Long Text', label: 'Query', default_value: null },
]

export async function up() {
  const [rt] = await sql`select 1 from table_def where name = 'Report'`
  if (!rt) return

  const existing = await sql`select column_name from column_def where parent = 'Report'`
  const have = new Set(existing.map((r) => r.column_name as string))
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Report'`
  let position = maxidx as number

  for (const f of NEW_COLUMNS) {
    // Report is a normal (non-single) Table, so each column also needs its
    // backing column on report. `add column if not exists` is idempotent,
    // so this also repairs a column_def that was added without its column.
    const type = pgType(f.column_type)
    if (type) await sql.unsafe(`alter table report add column if not exists "${f.column_name}" ${type}`)

    if (have.has(f.column_name)) continue
    position += 1
    await sql`insert into column_def ${sql({
      parent: 'Report',
      position,
      column_name: f.column_name,
      label: f.label,
      column_type: f.column_type,
      choices: (f as { choices?: string }).choices ?? null,
      reqd: false,
      unique: false,
      default_value: f.default_value,
      read_only: false,
      hidden: false,
      in_list_view: false,
      tier: 'basic',
    })}`
  }
}
