// PLAT-006: record which social provider (if any) a User authenticated with,
// so an OAuth-created/linked account is identifiable. Idempotent.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const [u] = await sql`select 1 from tab_doctype where name = 'User'`
  if (!u) return
  const existing = await sql`select fieldname from tab_docfield where parent = 'User'`
  const have = new Set(existing.map((r) => r.fieldname as string))
  if (have.has('social_login')) return

  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'User'`
  const type = columnType('Data')
  if (type) await sql.unsafe(`alter table tab_user add column if not exists "social_login" ${type}`)
  await sql`insert into tab_docfield ${sql({
    parent: 'User',
    idx: (maxidx as number) + 1,
    fieldname: 'social_login',
    label: 'Social Login',
    fieldtype: 'Data',
    options: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: true,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
