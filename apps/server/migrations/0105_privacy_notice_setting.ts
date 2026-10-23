// #401: the instance's privacy notice (markdown) lives in System Settings, so
// a public repo never carries a client's wording. /privacy renders it; blank
// = no notice (404). Same idempotent column_def pattern as 0099.
import { sql } from '../src/db'

export async function up() {
  const [ss] = await sql`select 1 from table_def where name = 'System Settings'`
  if (!ss) return // 0024 not applied — nothing to extend
  const [have] = await sql`select 1 from column_def where parent = 'System Settings' and column_name = 'privacy_notice'`
  if (have) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'System Settings'`
  await sql`insert into column_def ${sql({
    parent: 'System Settings',
    position: (maxidx as number) + 1,
    column_name: 'privacy_notice',
    label: 'Privacy Notice (Markdown)',
    column_type: 'Long Text',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
