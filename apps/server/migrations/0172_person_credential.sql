-- #1336: a person's password hash moves out of person into a table of its own.
-- The warehouse copies person; a secret beside it meant every new Person column
-- froze that copy. person_credential is never copied (rama_dw denies it), and,
-- like access_token and password_reset, it has no table_def row: no Table names
-- it, so the Admin, /api/table and the MCP cannot reach it.
--
-- This is the first of two steps. The release's pre-deploy runs this while the
-- old server still serves, and that server reads person.password_hash on every
-- signed-in request. So the column stays for now, kept in step both ways:
--   person -> person_credential: a write the old server makes in that window;
--   person_credential -> person: a write the new server makes, so a rollback to
--     the old server still finds every password.
-- The next release drops both triggers and the column (#1338). The new server
-- reads and writes only person_credential. The column stays denied in the
-- warehouse copy until then.
create table if not exists featherbase.person_credential (
  person_id character varying(140) primary key references featherbase.person (row_id) on delete cascade,
  password_hash character varying(140) not null,
  updated_at timestamp with time zone default now() not null
);

insert into featherbase.person_credential (person_id, password_hash)
select row_id, password_hash from featherbase.person where password_hash is not null
on conflict (person_id) do update set password_hash = excluded.password_hash, updated_at = now();

create or replace function featherbase.fc_person_password_to_credential() returns trigger
language plpgsql as $$
begin
  if new.password_hash is null then
    delete from featherbase.person_credential where person_id = new.row_id;
  else
    insert into featherbase.person_credential (person_id, password_hash) values (new.row_id, new.password_hash)
    on conflict (person_id) do update set password_hash = excluded.password_hash, updated_at = now()
      where featherbase.person_credential.password_hash is distinct from excluded.password_hash;
  end if;
  return null;
end $$;

-- Only a real change is carried: the new server's generic row save writes the
-- whole person row back, the column's stale value included, and that must not
-- touch the password.
drop trigger if exists person_password_to_credential on featherbase.person;
drop trigger if exists person_password_to_credential_insert on featherbase.person;
create trigger person_password_to_credential after update of password_hash on featherbase.person
  for each row when (old.password_hash is distinct from new.password_hash)
  execute function featherbase.fc_person_password_to_credential();
create trigger person_password_to_credential_insert after insert on featherbase.person
  for each row when (new.password_hash is not null)
  execute function featherbase.fc_person_password_to_credential();

create or replace function featherbase.fc_credential_password_to_person() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update featherbase.person set password_hash = null where row_id = old.person_id and password_hash is not null;
  else
    update featherbase.person set password_hash = new.password_hash
      where row_id = new.person_id and password_hash is distinct from new.password_hash;
  end if;
  return null;
end $$;

drop trigger if exists credential_password_to_person on featherbase.person_credential;
create trigger credential_password_to_person after insert or update or delete on featherbase.person_credential
  for each row execute function featherbase.fc_credential_password_to_person();
