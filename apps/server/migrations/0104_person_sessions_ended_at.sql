-- #391: sessions are signed tokens with no server-side row, so ending a
-- person's sessions without disabling them needs a cut-off: a session issued
-- before this instant is refused (src/auth.ts resolveToken). Null = none.
alter table featherbase.person add column if not exists sessions_ended_at timestamptz;
