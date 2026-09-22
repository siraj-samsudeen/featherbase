-- @spec identity_linking_requires_two_bound_proofs
alter table featherbase.login_operation
  add column purpose text not null default 'login' check (purpose in ('login', 'link', 'reauthenticate', 'enroll', 'recover')),
  add column source_session_id text references featherbase.login_session(id) on delete cascade,
  add column source_user_id text references featherbase."user"(row_id),
  add column source_user_generation bigint,
  add column source_authenticated_at timestamptz,
  add column expected_identity_id text references featherbase.external_identity(id),
  add constraint link_operation_source check (purpose <> 'link' or
    (source_session_id is not null and source_user_id is not null and source_user_generation is not null and source_authenticated_at is not null));
