// #430: the instance's own introduction for the sign-in invitation email
// (plain text) lives in System Settings, so a public repo never carries an
// organisation's wording. Blank = the email names the instance (app_name)
// and nothing more. Same idempotent column_def pattern as 0105.
import { sql } from '../src/db'

export async function up() {
  const [ss] = await sql`select 1 from table_def where name = 'System Settings'`
  if (!ss) return // 0024 not applied — nothing to extend
  const [have] = await sql`select 1 from column_def where parent = 'System Settings' and column_name = 'invitation_email_intro'`
  if (have) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'System Settings'`
  await sql`insert into column_def ${sql({
    parent: 'System Settings',
    position: (maxidx as number) + 1,
    column_name: 'invitation_email_intro',
    label: 'Invitation Email Introduction',
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
