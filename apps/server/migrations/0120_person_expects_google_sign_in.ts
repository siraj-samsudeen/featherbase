// #473 (link-google-sign-in-when-expected): a System Manager can mark a person
// as expecting Google sign-in. The first verified Google sign-in with that
// person's own address on an allowed domain then links to them, and the mark
// is cleared (sign-in.ts claimExpectedSignIn). Off by default, so no existing
// person changes. Same idempotent column_def pattern as 0114.
import { sql } from '../src/db'

export async function up() {
  const [person] = await sql`select 1 from table_def where name = 'Person'`
  if (!person) return
  await sql`alter table featherbase.person add column if not exists expects_google_sign_in boolean not null default false`
  const [have] = await sql`select 1 from column_def where parent = 'Person' and column_name = 'expects_google_sign_in'`
  if (have) return
  // Beside the email it applies to; everything after it moves down one.
  const [email] = await sql`select position from column_def where parent = 'Person' and column_name = 'email'`
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Person'`
  const position = email ? (email.position as number) + 1 : (maxidx as number) + 1
  if (email) await sql`update column_def set position = position + 1 where parent = 'Person' and position >= ${position}`
  await sql`insert into column_def ${sql({
    parent: 'Person',
    position,
    column_name: 'expects_google_sign_in',
    label: 'Expects Google sign-in',
    column_type: 'Check',
    reqd: false,
    unique: false,
    default_value: '0',
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
