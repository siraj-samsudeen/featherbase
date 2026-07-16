// PLAT-001: record which apps are installed and which DocTypes each one owns,
// so an uninstall knows what to tear down. App code (manifests, hook functions)
// lives in the codebase; this table is just the installed-state ledger.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    create table if not exists tab_installed_app (
      name text primary key,
      doctypes jsonb not null default '[]'::jsonb,
      installed_at timestamptz not null default now()
    )
  `)
}
