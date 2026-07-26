// PLAT-005 (#55): a declarative app is installed from a JSON manifest posted
// over the API, with no code in this repo. The manifest is persisted so
// uninstall and boot work from stored data rather than process memory; for
// code-registered apps the column stays null.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    alter table tab_installed_app
      add column if not exists manifest jsonb
  `)
}
