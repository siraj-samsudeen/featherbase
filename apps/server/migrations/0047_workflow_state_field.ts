// Workflow state binding: a Workflow may name the field on its target DocType
// that carries the state (`state_field`, Frappe's workflow_state_field). Blank
// keeps the auto-added `workflow_state` field. Idempotent: adds the column +
// docfield only if missing.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const [dt] = await sql`select 1 from tab_doctype where name = 'Workflow'`
  if (!dt) return
  const existing = await sql`select fieldname from tab_docfield where parent = 'Workflow'`
  if (existing.some((r) => r.fieldname === 'state_field')) return

  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'Workflow'`
  const type = columnType('Data')
  if (type) await sql.unsafe(`alter table tab_workflow add column if not exists "state_field" ${type}`)
  await sql`insert into tab_docfield ${sql({
    parent: 'Workflow',
    idx: (maxidx as number) + 1,
    fieldname: 'state_field',
    label: 'State Field',
    fieldtype: 'Data',
    options: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
