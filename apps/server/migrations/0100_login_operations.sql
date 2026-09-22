-- @spec hosted_login_validates_subject_and_browser_operation
create table featherbase.login_operation (
  state_hash text primary key,
  browser_hash text not null,
  provider_id text not null references featherbase.login_provider(id),
  provider_generation bigint not null,
  nonce text not null,
  pkce_verifier text not null,
  redirect_uri text not null,
  return_to text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes'
);
create index login_operation_expiry on featherbase.login_operation(expires_at);

-- @spec session_handoff_is_bound_one_use_and_revocation_aware
create table featherbase.login_handoff (
  code_hash text primary key,
  credential_hash text not null,
  session_id text not null references featherbase.login_session(id) on delete cascade,
  return_to text,
  expires_at timestamptz not null default clock_timestamp() + interval '1 minute'
);
create index login_handoff_expiry on featherbase.login_handoff(expires_at);
revoke all on featherbase.login_operation, featherbase.login_handoff from public, app_client;
