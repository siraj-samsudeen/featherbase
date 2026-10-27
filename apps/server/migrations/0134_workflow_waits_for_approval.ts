// #569: approval notifications are explicit per state, never inferred from
// having outgoing actions. Existing workflows opt in through the generic form.
import { sql } from '../src/db'

export async function up() {
  const [table] = await sql`select 1 from table_def where name = 'Workflow Document State'`
  if (!table) return
  await sql`alter table featherbase.workflow_document_state
    add column if not exists waits_for_approval boolean not null default false`
  const [existing] = await sql`select 1 from column_def
    where parent = 'Workflow Document State' and column_name = 'waits_for_approval'`
  if (existing) return

  const [status] = await sql`select position from column_def
    where parent = 'Workflow Document State' and column_name = 'target_status'`
  const position = Number(status.position) + 1
  await sql`update column_def set position = position + 1
    where parent = 'Workflow Document State' and position >= ${position}`
  await sql`insert into column_def ${sql({
    parent: 'Workflow Document State', position,
    column_name: 'waits_for_approval', label: 'Waits for approval',
    column_type: 'Check', default_value: '0',
    reqd: false, unique: false, read_only: false, hidden: false,
    in_list_view: true, tier: 'basic',
  })}`
}
