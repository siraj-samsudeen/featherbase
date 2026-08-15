// `internal_metadata` — what this DATABASE is, as opposed to what is in it.
// Today it holds one key, `environment`, stamped by the migrator so a later
// run can refuse to operate on a database belonging to somebody else (see
// src/db-environment.ts).
//
// Created by a migration rather than lazily on first use, which is the rule
// 0079 established for `patch_log`: an engine-owned table that appears only
// after some other code path has run makes a freshly migrated database differ
// from a used one, and turns any test that counts platform tables into an
// order-dependent one.
import { sql } from '../src/db'
import { stampEnvironment } from '../src/db-environment'

export async function up() {
  await sql`create table if not exists internal_metadata (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
  )`
  // Claim the database for whichever environment is migrating it. Existing
  // developer checkouts are migrated from a dev shell and so become
  // 'development'; a test database is created under NODE_ENV=test and becomes
  // 'test'. Neither can then be mistaken for the other.
  await stampEnvironment()
}
