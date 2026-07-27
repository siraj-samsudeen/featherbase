// SET-002: user management — password-reset tokens and a profile avatar.
import { sql } from '../src/db'
import { pgType } from '../src/doctype-engine'

export async function up() {
  // Short-lived, single-use password reset tokens (consumed on use).
  await sql`create table if not exists password_reset (
    token text primary key,
    "user" varchar(140) not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )`

  // Avatar on the User profile (an Attach Image URL). Idempotent: column_def +
  // backing column on "user".
  const [f] = await sql`select 1 from column_def where parent = 'User' and column_name = 'user_image'`
  const type = pgType('Attach Image')
  if (type) await sql.unsafe(`alter table "user" add column if not exists "user_image" ${type}`)
  if (!f) {
    const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
    await sql`insert into column_def ${sql({
      parent: 'User',
      position: (maxidx as number) + 1,
      column_name: 'user_image',
      label: 'User Image',
      column_type: 'Attach Image',
      reqd: false,
      unique: false,
      default_value: null,
      read_only: false,
      hidden: false,
      in_list_view: false,
      tier: 'basic',
    })}`
  }
}
