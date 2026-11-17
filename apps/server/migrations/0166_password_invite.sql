-- #1257: password invites. An administrator sends a person who has no way to
-- sign in a one-time link that sets their first password. One row per link;
-- only a SHA-256 of the link's key is stored. A row is spent when used
-- (used_at), voided when replaced or no longer valid (voided_at), and
-- otherwise lives until expires_at. Internal, like password_reset: no Table
-- metadata, never read or written through the generic Table paths.
create table if not exists featherbase.password_invite (
  id text primary key,
  person text not null,
  token_hash text not null unique,
  invited_by text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  -- When the email went out; null while sending and for a send that failed.
  sent_at timestamp with time zone,
  -- Burned the moment the link is used, in its own transaction, before the
  -- password write; accepted_at is set only when that write lands.
  used_at timestamp with time zone,
  accepted_at timestamp with time zone,
  voided_at timestamp with time zone
);
create index if not exists password_invite_person on featherbase.password_invite using btree (person, created_at);

-- The link went to the person's address: any change to it — set, changed or
-- cleared — voids every link not yet used, like a Google invite.
create or replace function featherbase.fc_void_password_invites() returns trigger
  language plpgsql
  set search_path to 'pg_catalog'
  as $$
  begin
    if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
      update featherbase.password_invite set voided_at = now()
      where person = new.row_id and used_at is null and voided_at is null;
    end if;
    return new;
  end $$;

drop trigger if exists person_void_password_invites on featherbase.person;
create trigger person_void_password_invites after update of email on featherbase.person
  for each row execute function featherbase.fc_void_password_invites();
