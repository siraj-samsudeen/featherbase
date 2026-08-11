// UPS-R1 + UPS-R5 (spec 0004): the Import Log learns what an upsert run did
// and what it chose. `updated` joins inserted/failed as a separate count;
// `key_column` and `empty_cells` record the run's match key and empty-cell
// choice — the pair the wizard offers back as the visible "Match on X, as
// last time" suggestion. Converges existing databases; fresh installs get
// the shape from the rewritten 0056.
import { sql } from '../src/db'
import { tableName } from '../src/doctype-engine'
import { invalidateMeta } from '../src/meta'

const NEW_COLUMNS = [
  { column_name: 'updated', label: 'Updated', column_type: 'Int', pg: 'bigint', in_list_view: true },
  { column_name: 'key_column', label: 'Key Column', column_type: 'Data', pg: 'varchar(140)', in_list_view: false },
  { column_name: 'empty_cells', label: 'Empty Cells', column_type: 'Choice', pg: 'text', choices: 'keep\nclear', in_list_view: false },
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
      choices: col.choices ?? null,
      reqd: false,
      unique: false,
      read_only: false,
      hidden: false,
      in_list_view: col.in_list_view,
      tier: 'basic',
    })}`
    await sql.unsafe(
      `alter table "${tableName('Import Log')}" add column if not exists "${col.column_name}" ${col.pg}`,
    )
  }
  invalidateMeta('Import Log')
}
