// An app may declare Data Sources (and which of their relations to reflect).
// The install ledger records the sources this app CREATED — adopted ones are
// left out, so uninstall can never remove a source that predated the app.
// Sources tear down LAST, after the app's Tables: a Data Source with bound
// Tables still attached refuses deletion by design.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    alter table installed_app add column if not exists sources jsonb`)
}
