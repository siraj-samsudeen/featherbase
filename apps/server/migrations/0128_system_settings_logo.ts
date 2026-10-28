// #380 task 4.2: the instance's own logo for the sign-in page lives in System
// Settings, so a client's mark is set at runtime and never ships in this
// repo. Blank = the Featherbase mark. Same idempotent column_def pattern as
// 0114; a fresh install reaches it after 0024 creates System Settings.
import { sql } from '../src/db'

export async function up() {
  const [ss] = await sql`select 1 from table_def where name = 'System Settings'`
  if (!ss) return // 0024 not applied — nothing to extend
  const [have] = await sql`select 1 from column_def where parent = 'System Settings' and column_name = 'logo'`
  if (have) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'System Settings'`
  await sql`insert into column_def ${sql({
    parent: 'System Settings',
    position: (maxidx as number) + 1,
    column_name: 'logo',
    label: 'Logo',
    column_type: 'Attach Image',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
