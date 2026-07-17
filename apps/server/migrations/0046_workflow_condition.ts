// Conditional transitions: a Workflow Transition may carry a `condition` — a
// boolean expression over `doc` that must hold for the transition to be
// offered and to be applied. Empty condition = always allowed (unchanged
// behaviour). Idempotent: adds the column + docfield only if missing.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const [dt] = await sql`select 1 from tab_doctype where name = 'Workflow Transition'`
  if (!dt) return
  const existing = await sql`select fieldname from tab_docfield where parent = 'Workflow Transition'`
  if (existing.some((r) => r.fieldname === 'condition')) return

  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'Workflow Transition'`
  const type = columnType('Text')
  if (type) await sql.unsafe(`alter table tab_workflow_transition add column if not exists "condition" ${type}`)
  await sql`insert into tab_docfield ${sql({
    parent: 'Workflow Transition',
    idx: (maxidx as number) + 1,
    fieldname: 'condition',
    label: 'Condition',
    fieldtype: 'Text',
    options: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: true,
    permlevel: 0,
  })}`
}
