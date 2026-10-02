// Delegated password sign-in (OpenSpec change `delegated-password-login`):
// an outside service checks a person's ID and password (StyleHR is the
// first), configured on the System Settings single like Google sign-in was
// in 0070. Blank URL = off. Same idempotent column_def pattern as 0070.
import { sql } from '../src/db'

const NEW_COLUMNS = [
  { column_name: 'delegated_login_label', column_type: 'Data', label: 'Delegated Login Label' },
  { column_name: 'delegated_login_url', column_type: 'Data', label: 'Delegated Login URL' },
  { column_name: 'delegated_login_user_column', column_type: 'Data', label: 'Delegated Login User Column' },
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
      reqd: false,
      unique: false,
      default_value: null,
      read_only: false,
      hidden: false,
      in_list_view: false,
      tier: 'basic',
    })}`
  }
}
