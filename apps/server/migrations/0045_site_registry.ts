// PLAT-008: the site registry lives in the shared (public) schema and maps an
// inbound Host to a site + its dedicated schema. Site data itself lives in the
// per-site schemas, never here.
import { sql } from '../src/db'

export async function up() {
  await sql.unsafe(`
    create table if not exists tab_site (
      name text primary key,
      host text unique not null,
      schema text not null,
      created_at timestamptz not null default now()
    )
  `)
}
