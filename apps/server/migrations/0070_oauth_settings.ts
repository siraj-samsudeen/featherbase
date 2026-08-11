// PLAT-006: Google OAuth becomes instance configuration, not deployment env.
// The client id and the login-domain allowlist are not secrets — they belong
// in System Settings, where a manifest fixture can check them in and the
// Admin UI can edit them. Only GOOGLE_CLIENT_SECRET stays in the environment.
// Same idempotent column_def pattern as 0025.
import { sql } from '../src/db'

const NEW_COLUMNS = [
  { column_name: 'google_client_id', column_type: 'Data', label: 'Google OAuth Client ID' },
  { column_name: 'allowed_login_domains', column_type: 'Data', label: 'Allowed Login Domains' },
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
