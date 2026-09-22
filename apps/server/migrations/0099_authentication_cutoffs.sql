-- @spec login_sessions_are_revocable_on_every_use
-- Anonymous login has no User generation to capture until its subject is known.
-- Retain a monotonic cutoff for operations begun before revocation as well.
alter table featherbase."user" add column authentication_valid_after timestamptz not null default '-infinity';
alter table featherbase.external_identity add column authentication_valid_after timestamptz not null default '-infinity';

create or replace function featherbase.advance_user_auth_generation() returns trigger
language plpgsql as $$
begin
  new.auth_generation := old.auth_generation;
  new.authentication_valid_after := old.authentication_valid_after;
  if (old.enabled and not new.enabled)
     or old.password_hash is distinct from new.password_hash
     or old.user_type is distinct from new.user_type
     or (old.native_login_enabled and not new.native_login_enabled) then
    new.auth_generation := old.auth_generation + 1;
    new.authentication_valid_after := clock_timestamp();
  end if;
  return new;
end
$$;

create or replace function featherbase.guard_external_identity() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.provider_id <> old.provider_id
    or new.issuer <> old.issuer or new.subject <> old.subject then
    raise exception 'External identity ownership is immutable';
  end if;
  new.auth_generation := old.auth_generation;
  new.authentication_valid_after := old.authentication_valid_after;
  if old.revoked_at is null and new.revoked_at is not null then
    new.auth_generation := old.auth_generation + 1;
    new.authentication_valid_after := clock_timestamp();
  end if;
  return new;
end
$$;
