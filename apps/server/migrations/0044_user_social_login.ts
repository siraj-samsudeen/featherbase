// PLAT-006: record which social provider (if any) a User authenticated with,
// so an OAuth-created/linked account is identifiable. Idempotent.
import { sql } from '../src/db'
import { pgType } from '../src/doctype-engine'

export async function up() {
  const [u] = await sql`select 1 from table_def where name = 'User'`
  if (!u) return
  const existing = await sql`select column_name from column_def where parent = 'User'`
  const have = new Set(existing.map((r) => r.column_name as string))
  if (have.has('social_login')) return

  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
  const type = pgType('Data')
  if (type) await sql.unsafe(`alter table "user" add column if not exists "social_login" ${type}`)
  await sql`insert into column_def ${sql({
    parent: 'User',
    position: (maxidx as number) + 1,
    column_name: 'social_login',
    label: 'Social Login',
    column_type: 'Data',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: true,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
