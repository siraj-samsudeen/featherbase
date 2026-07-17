// UI-024: per-user theme preference (light/dark).
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const type = columnType('Select')
  if (type) await sql.unsafe(`alter table tab_user add column if not exists "theme" ${type}`)
  const [f] = await sql`select 1 from tab_docfield where parent = 'User' and fieldname = 'theme'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'User'`
  await sql`insert into tab_docfield ${sql({
    parent: 'User',
    idx: (maxidx as number) + 1,
    fieldname: 'theme',
    label: 'Theme',
    fieldtype: 'Select',
    options: 'light\ndark',
    reqd: false,
    unique: false,
    default_value: 'light',
    read_only: false,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
