-- #86: the direct-client login role was called `desk_client`, after Frappe's
-- "Desk" — the term #84 retired from the URL prefix. It is now `app_client`.
--
-- 0010_rls.sql was rewritten in place to create the final name, so a FRESH
-- database never sees the old one. This migration converges databases that
-- already applied 0010 (which recorded it as applied and will not re-run it).
--
-- Renaming is enough: policies and grants reference the role by OID, not by
-- name, so every `to desk_client` policy created by 0010/0055/0060 and by the
-- runtime DDL in doctype-engine.ts follows the rename automatically. Nothing
-- has to be recreated.
--
-- The password is re-set explicitly: an MD5-hashed password is derived from
-- the role name, so PostgreSQL clears it on rename (SCRAM hashes survive).
-- Setting it unconditionally makes the outcome the same either way.

do $$ begin
  if exists (select from pg_roles where rolname = 'desk_client')
     and not exists (select from pg_roles where rolname = 'app_client') then
    alter role desk_client rename to app_client;
    alter role app_client with login password 'app_client';
  elsif not exists (select from pg_roles where rolname = 'app_client') then
    -- Neither role present (a database predating the role, or one whose role
    -- was dropped by hand): create it as 0010 would have.
    create role app_client login password 'app_client';
    grant usage on schema public to app_client;
  end if;
  -- Both present: a hand-made app_client already exists. Leave it alone —
  -- silently merging two roles' grants is not something a migration should
  -- guess at.
end $$;
