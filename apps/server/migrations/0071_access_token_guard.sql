-- #137: guard the credential store against a user Table that squats its
-- physical name.
--
-- A developer database may already carry an `access_token` table created from
-- a user-defined Table named "Access Token" (metadata Tables compile to the
-- lowercased name). 0069's `create table if not exists` would silently adopt
-- that foreign table and never apply the real schema, leaving authentication
-- querying columns that do not exist.
--
-- WHY THIS IS ITS OWN MIGRATION rather than a few lines added to 0069:
-- `runMigrations` (src/migrate.ts) skips any file already recorded in the
-- `migration` table. Editing 0069 in place therefore protects nobody — every
-- checkout that has already applied it would skip the new guard forever, and
-- on a fresh database the guard is vacuous because `access_token` cannot
-- pre-exist its own creating migration. A NEW file is the only version of
-- this check that actually runs against the databases that are at risk.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = current_schema() and table_name = 'access_token')
     and not exists (select 1 from information_schema.columns
                     where table_schema = current_schema()
                       and table_name = 'access_token' and column_name = 'token_hash')
  then
    raise exception 'a table named "access_token" already exists and is not the '
      'credential store (no token_hash column). It is most likely a Table named '
      '"Access Token" — rename or drop it, then re-run migrations.';
  end if;
end $$;
