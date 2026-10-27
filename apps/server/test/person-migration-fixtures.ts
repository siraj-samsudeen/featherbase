// The pre-0101 database shape, put back inside a test's rolled-back
// transaction. 0101 (person-rename) renamed `user` → `person` and
// `user_identity` → `sign_in_identity`, renamed their keys, indexes and
// triggers, and renamed the Table "User" → "Person" everywhere a Table name
// is stored. 0100 ran before all of that and 0101 ran on it, so both are
// proven against this shape (migration-0100 / migration-0101 tests).
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function pre0101Shape() {
  await sql.unsafe(`alter table featherbase.person drop constraint if exists person_id_namespace`)
  await sql.unsafe(`drop trigger if exists person_id_is_permanent on featherbase.person`)
  await sql.unsafe(`drop trigger if exists person_cancel_email_invites on featherbase.person`)
  await sql.unsafe(`alter table featherbase.person rename to "user"`)
  await sql.unsafe(`alter table featherbase."user" rename constraint person_pkey to user_pkey`)
  // 0101 renamed the 0100 indexes; give them back their 0100 names.
  await sql.unsafe(`alter index featherbase.person_email_lower_uq rename to user_email_lower_uq`)
  await sql.unsafe(`alter index featherbase.person_username_lower_uq rename to user_username_lower_uq`)
  await sql.unsafe(`alter table featherbase."user" add column if not exists user_type varchar(140) not null default 'human'`)
  await sql.unsafe(`create trigger user_person_id_is_permanent before update of row_id on featherbase."user"
    for each row execute function featherbase.fc_person_id_is_permanent()`)
  await sql.unsafe(`alter table featherbase.sign_in_identity rename to user_identity`)
  await sql.unsafe(`alter table featherbase.user_identity rename column person_id to user_id`)
  for (const [from, to] of [
    ['sign_in_identity_pkey', 'user_identity_pkey'],
    ['sign_in_identity_subject_or_pending', 'user_identity_subject_or_pending'],
    ['sign_in_identity_person_id_fkey', 'user_identity_user_id_fkey'],
    ['sign_in_identity_method_fkey', 'user_identity_method_fkey'],
  ])
    await sql.unsafe(`alter table featherbase.user_identity rename constraint ${from} to ${to}`)
  for (const [from, to] of [
    ['sign_in_identity_subject_uq', 'user_identity_subject_uq'],
    ['sign_in_identity_sign_in_name_uq', 'user_identity_sign_in_name_uq'],
    ['sign_in_identity_pending_uq', 'user_identity_pending_uq'],
    ['sign_in_identity_person_ix', 'user_identity_user_ix'],
  ])
    await sql.unsafe(`alter index featherbase.${from} rename to ${to}`)
  await sql.unsafe(`
    create or replace function featherbase.fc_cancel_email_invites() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
        delete from featherbase.user_identity where user_id = new.row_id and subject is null;
      end if;
      return new;
    end $$`)
  await sql.unsafe(`create trigger user_cancel_email_invites after update of email on featherbase."user"
    for each row execute function featherbase.fc_cancel_email_invites()`)
  // The Table was "User": its metadata row, and the Table name wherever stored.
  const [person] = await sql`select * from table_def where name = 'Person'`
  await sql`insert into table_def ${sql({ ...(person as Record<string, unknown>), name: 'User', label: 'User', id_pattern: 'prompt' } as unknown as Record<string, never>)}`
  await sql`update column_def set parent = 'User' where parent = 'Person'`
  await sql`update column_def set reference_table = 'User' where reference_table = 'Person'`
  await sql`update custom_field set dt = 'User' where dt = 'Person'`
  await sql`delete from table_def where name = 'Person'`
  await sql`update permission set ref_table = 'User' where ref_table = 'Person'`
  await sql`update has_role set parenttype = 'User' where parenttype = 'Person'`
  await sql`update home_page_link set label = 'User', link_to = 'User' where link_to = 'Person'`
  invalidateMeta()
}
