-- #411: sessions are signed tokens, so signing out ends one only if the
-- server remembers it. Each session carries a unique id (`jti`); sign-out
-- records it here and resolveToken refuses it until the token would have
-- expired anyway. Rows past expires_at are pruned on every sign-out.
-- A plain `create table` on purpose: a user Table named "Revoked Session"
-- squatting this name must fail the migration, not be adopted (see 0071).
create table revoked_session (
  jti text primary key,
  person_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now()
);
create index revoked_session_expiry on revoked_session (expires_at);
