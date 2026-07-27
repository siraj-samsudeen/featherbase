// PLAT-004 (#54): an app manifest can declare roles and DocPerms. The install
// ledger must record what each install genuinely CREATED (as opposed to what
// the manifest asked for) so uninstall removes exactly that and never a role
// or grant that predated the app — same job the `doctypes` column already
// does for tables.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    alter table installed_app
      add column if not exists roles jsonb not null default '[]'::jsonb,
      add column if not exists perms jsonb not null default '[]'::jsonb
  `)
}
