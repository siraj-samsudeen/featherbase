// Conditional transitions: a Workflow Transition may carry a `condition` — a
// boolean expression over `doc` that must hold for the transition to be
// offered and to be applied. Empty condition = always allowed (unchanged
// behaviour). Idempotent: adds the column + column_def only if missing.
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const [dt] = await sql`select 1 from table_def where name = 'Workflow Transition'`
  if (!dt) return
  const existing = await sql`select column_name from column_def where parent = 'Workflow Transition'`
  if (existing.some((r) => r.column_name === 'condition')) return

  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Workflow Transition'`
  const type = pgType('Text')
  if (type) await sql.unsafe(`alter table workflow_transition add column if not exists "condition" ${type}`)
  await sql`insert into column_def ${sql({
    parent: 'Workflow Transition',
    position: (maxidx as number) + 1,
    column_name: 'condition',
    label: 'Condition',
    column_type: 'Text',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: false,
    hidden: false,
    in_list_view: true,
    tier: 'basic',
  })}`
}
