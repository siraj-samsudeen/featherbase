// SET-004: System Settings gains the fields that drive global rendering —
// currency, decimal precision for Currency/Float, and the session lifetime.
// Idempotent: only inserts column_defs that are not already present. Singles
// have no table, so this is pure metadata (column_def) — no column DDL.
import { sql } from '../src/db'

const NEW_COLUMNS = [
  { column_name: 'currency', column_type: 'Choice', label: 'Default Currency', choices: 'USD\nEUR\nGBP\nINR\nJPY', default_value: 'USD' },
  { column_name: 'currency_precision', column_type: 'Int', label: 'Currency Precision', default_value: '2' },
  { column_name: 'float_precision', column_type: 'Int', label: 'Float Precision', default_value: '2' },
]

export async function up() {
  const [ss] = await sql`select 1 from table_def where name = 'System Settings'`
  if (!ss) return // 0024 not applied (fresh non-single install) — nothing to extend

  const existing = await sql`select column_name from column_def where parent = 'System Settings'`
  const have = new Set(existing.map((r) => r.column_name as string))
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'System Settings'`
  let position = maxidx as number

  for (const f of NEW_COLUMNS) {
    if (have.has(f.column_name)) continue
    position += 1
    await sql`insert into column_def ${sql({
      parent: 'System Settings',
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
