// UI-025: per-user color palette (classic/ivory/graphite/indigo), the second
// theming axis alongside light/dark. Mirrors 0035_user_theme.
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const type = pgType('Choice')
  if (type) await sql.unsafe(`alter table "user" add column if not exists "palette" ${type}`)
  const [f] = await sql`select 1 from column_def where parent = 'User' and column_name = 'palette'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
  await sql`insert into column_def ${sql({
    parent: 'User',
    position: (maxidx as number) + 1,
    column_name: 'palette',
    label: 'Palette',
    column_type: 'Choice',
    choices: 'classic\nivory\ngraphite\nindigo',
    reqd: false,
    unique: false,
    default_value: 'classic',
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
