// SET-002: user management — password-reset tokens and a profile avatar.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  // Short-lived, single-use password reset tokens (consumed on use).
  await sql`create table if not exists password_reset (
    token text primary key,
    "user" varchar(140) not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )`

  // Avatar on the User profile (an Attach Image URL). Idempotent: docfield +
  // backing column on tab_user.
  const [f] = await sql`select 1 from tab_docfield where parent = 'User' and fieldname = 'user_image'`
  const type = columnType('Attach Image')
  if (type) await sql.unsafe(`alter table tab_user add column if not exists "user_image" ${type}`)
  if (!f) {
    const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'User'`
    await sql`insert into tab_docfield ${sql({
      parent: 'User',
      idx: (maxidx as number) + 1,
      fieldname: 'user_image',
      label: 'User Image',
      fieldtype: 'Attach Image',
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
}
