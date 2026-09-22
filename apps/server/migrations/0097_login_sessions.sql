-- @spec login_sessions_are_revocable_on_every_use
-- Security state is infrastructure, never a generic editable Table.
alter table featherbase."user"
  add column auth_generation bigint not null default 0,
  add column native_login_enabled boolean not null default true,
  add column identity_enrolled boolean not null default false;

update featherbase."user" set
  native_login_enabled = user_type <> 'service' and password_hash is not null and password_hash <> '',
  identity_enrolled = true;

create table featherbase.login_session (
  id text primary key,
  user_id text not null references featherbase."user"(row_id) on delete cascade,
  method text not null check (method in ('native', 'internal', 'external')),
  user_generation bigint not null,
  authenticated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index login_session_user on featherbase.login_session(user_id);

create function featherbase.advance_user_auth_generation() returns trigger
language plpgsql as $$
begin
  -- Compare the old generation even if the write tries to supply a new one.
  new.auth_generation := old.auth_generation;
  if (old.enabled and not new.enabled)
     or old.password_hash is distinct from new.password_hash
     or old.user_type is distinct from new.user_type
     or (old.native_login_enabled and not new.native_login_enabled) then
    new.auth_generation := old.auth_generation + 1;
  end if;
  return new;
end
$$;
create trigger user_auth_generation before update on featherbase."user"
for each row execute function featherbase.advance_user_auth_generation();

revoke all on featherbase.login_session from public, app_client;
