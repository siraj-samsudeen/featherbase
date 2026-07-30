// PLAT-006 (#78): an app manifest can ship fixture documents (workflows,
// email rules, server scripts, SLAs, web forms, sample rows — anything
// saveDoc can save). The install ledger must record which fixture rows each
// install genuinely CREATED (as opposed to what the manifest asked for) so
// uninstall removes exactly those and never a row that predated the app —
// same job the `roles`/`perms` columns (0053) do for access, and `tables`
// (0043) for schema. Each entry is { table, name }.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    alter table installed_app
      add column if not exists fixtures jsonb not null default '[]'::jsonb
  `)
}
