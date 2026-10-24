// #409: a report read can be limited to one of several stores, so the Access Log
// says what the read was limited to (`store=1501`), keeping "who viewed which
// store" answerable. Same idempotent column_def pattern as 0105; a no-op where
// the Access Log Table does not exist.
import { sql } from '../src/db'

export async function up() {
  const [log] = await sql`select 1 from table_def where name = 'Access Log'`
  if (!log) return
  await sql`alter table access_log add column if not exists scope text`
  const [have] = await sql`select 1 from column_def where parent = 'Access Log' and column_name = 'scope'`
  if (have) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Access Log'`
  await sql`insert into column_def ${sql({
    parent: 'Access Log',
    position: (maxidx as number) + 1,
    column_name: 'scope',
    label: 'Scope',
    column_type: 'Data',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
