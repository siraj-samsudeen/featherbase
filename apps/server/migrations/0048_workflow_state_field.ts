// Workflow state binding: a Workflow may name the field on its target Table
// that carries the state (`state_field`, Frappe's workflow_state_field). Blank
// keeps the auto-added `workflow_state` field. Idempotent: adds the column +
// column_def only if missing.
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const [dt] = await sql`select 1 from table_def where name = 'Workflow'`
  if (!dt) return
  const existing = await sql`select column_name from column_def where parent = 'Workflow'`
  if (existing.some((r) => r.column_name === 'state_field')) return

  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Workflow'`
  const type = pgType('Data')
  if (type) await sql.unsafe(`alter table workflow add column if not exists "state_field" ${type}`)
  await sql`insert into column_def ${sql({
    parent: 'Workflow',
    position: (maxidx as number) + 1,
    column_name: 'state_field',
    label: 'State Field',
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
