-- @spec external_enrollment_requires_explicit_authority
create table featherbase.identity_invitation (
  secret_hash text primary key,
  purpose text not null check (purpose in ('enroll', 'recover')),
  user_id text not null references featherbase."user"(row_id),
  user_generation bigint not null,
  provider_id text not null references featherbase.login_provider(id),
  provider_generation bigint not null,
  issued_by text not null references featherbase."user"(row_id),
  expires_at timestamptz not null default clock_timestamp() + interval '15 minutes'
);
alter table featherbase.login_operation
  add column invited_user_id text references featherbase."user"(row_id),
  add column invited_user_generation bigint,
  add constraint invited_operation_target check (purpose not in ('enroll', 'recover') or
    (invited_user_id is not null and invited_user_generation is not null));

-- @spec identity_unlink_and_recovery_preserve_account_control
create table featherbase.identity_recovery (
  id text primary key,
  user_id text not null references featherbase."user"(row_id),
  user_generation bigint not null,
  provider_id text not null references featherbase.login_provider(id),
  provider_generation bigint not null,
  issuer text not null,
  subject text not null,
  email text,
  email_verified boolean not null,
  display_name text,
  expires_at timestamptz not null default clock_timestamp() + interval '15 minutes',
  approved_at timestamptz,
  approved_by text references featherbase."user"(row_id),
  verification_method text,
  case_reference text
);
alter table featherbase."user" add column recovery_completed_at timestamptz;

create or replace function featherbase.advance_user_auth_generation() returns trigger
language plpgsql as $$
begin
  new.auth_generation := old.auth_generation;
  new.authentication_valid_after := old.authentication_valid_after;
  if (old.enabled and not new.enabled)
     or old.password_hash is distinct from new.password_hash
     or old.user_type is distinct from new.user_type
     or (old.native_login_enabled and not new.native_login_enabled)
     or old.recovery_completed_at is distinct from new.recovery_completed_at then
    new.auth_generation := old.auth_generation + 1;
    new.authentication_valid_after := clock_timestamp();
  end if;
  return new;
end
$$;
revoke all on featherbase.identity_invitation, featherbase.identity_recovery from public, app_client;
