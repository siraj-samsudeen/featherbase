// `patch_log` was the one engine-owned raw table created LAZILY — by
// ensurePatchLog() on the first patch run — rather than by a migration like
// the other nine (`series`, `migration`, `installed_app`, `site`,
// `single_value`, `password_reset`, `tag_link`, `access_token`,
// `user_settings`).
//
// That made a freshly migrated database differ from a used one, and
// token-hardening's #137 R2 witness — which asserts all ten reserved tables
// exist — failed on a fresh database unless patches.test.ts happened to run
// first. An order-dependent test is a bad witness for a security rule.
//
// Same DDL as ensurePatchLog(), which stays (it is idempotent and still
// guards the patch runner's own first call).
import { sql } from '../src/db'

export async function up() {
  await sql`create table if not exists patch_log (
    patch text primary key,
    applied_at timestamptz not null default now()
  )`
}
