// UI-024: per-user theme preference (light/dark).
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const type = pgType('Choice')
  if (type) await sql.unsafe(`alter table "user" add column if not exists "theme" ${type}`)
  const [f] = await sql`select 1 from column_def where parent = 'User' and column_name = 'theme'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
  await sql`insert into column_def ${sql({
    parent: 'User',
    position: (maxidx as number) + 1,
    column_name: 'theme',
    label: 'Theme',
    column_type: 'Choice',
    choices: 'light\ndark',
    reqd: false,
    unique: false,
    default_value: 'light',
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
