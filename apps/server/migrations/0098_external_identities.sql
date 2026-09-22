-- @spec external_identity_ownership_is_subject_based
alter table featherbase."user" alter column email drop not null;
update featherbase.column_def set reqd = false where parent = 'User' and column_name = 'email';

create table featherbase.login_provider (
  id text primary key,
  kind text not null check (kind in ('google', 'microsoft', 'stylehr')),
  issuer text not null,
  client_id text not null,
  enabled boolean not null default false,
  auth_generation bigint not null default 0,
  check (kind <> 'google' or issuer = 'https://accounts.google.com'),
  check (kind <> 'microsoft' or issuer = 'https://login.microsoftonline.com/common/v2.0'),
  check (not enabled or (kind <> 'stylehr' and client_id <> ''))
);

create table featherbase.external_identity (
  id text primary key,
  user_id text not null references featherbase."user"(row_id),
  provider_id text not null references featherbase.login_provider(id),
  issuer text collate "C" not null,
  subject text collate "C" not null check (subject <> ''),
  email text,
  email_verified boolean not null default false,
  display_name text,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  auth_generation bigint not null default 0,
  unique (provider_id, issuer, subject)
);
create index external_identity_user on featherbase.external_identity(user_id);

alter table featherbase.login_session
  add column identity_id text references featherbase.external_identity(id),
  add column identity_generation bigint,
  add column provider_generation bigint,
  add constraint session_identity_method check (
    (method = 'external' and identity_id is not null and identity_generation is not null and provider_generation is not null)
    or (method <> 'external' and identity_id is null and identity_generation is null and provider_generation is null)
  );

-- @spec provider_configuration_is_an_authentication_boundary
create function featherbase.guard_login_provider() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.kind <> old.kind or new.issuer <> old.issuer or new.client_id <> old.client_id then
    raise exception 'A login provider namespace is immutable; create a new provider';
  end if;
  new.auth_generation := old.auth_generation;
  if old.enabled and not new.enabled then new.auth_generation := old.auth_generation + 1; end if;
  return new;
end
$$;
create trigger login_provider_guard before update on featherbase.login_provider
for each row execute function featherbase.guard_login_provider();

-- @spec identity_unlink_and_recovery_preserve_account_control
create function featherbase.guard_external_identity() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.provider_id <> old.provider_id
    or new.issuer <> old.issuer or new.subject <> old.subject then
    raise exception 'External identity ownership is immutable';
  end if;
  new.auth_generation := old.auth_generation;
  if old.revoked_at is null and new.revoked_at is not null then new.auth_generation := old.auth_generation + 1; end if;
  return new;
end
$$;
create trigger external_identity_guard before update on featherbase.external_identity
for each row execute function featherbase.guard_external_identity();

revoke all on featherbase.login_provider, featherbase.external_identity from public, app_client;
