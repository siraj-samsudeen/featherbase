-- #1222: View as. One row per signed-in session that is viewing as someone:
-- the tester, the person viewed, and when it ends. Keyed by the session's id
-- (the token's jti), so it lives and dies with that one session and never
-- travels to another browser. Internal, like revoked_session: no Table
-- metadata, never read or written through the generic Table paths.
create table if not exists featherbase.view_as_session (
  session_id text primary key,
  tester text not null,
  person text not null,
  started_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null
);
create index if not exists view_as_session_expiry on featherbase.view_as_session using btree (expires_at);
