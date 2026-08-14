-- #86: the direct-client login role was called `desk_client`, after Frappe's
-- "Desk" — the term #84 retired from the URL prefix. It is now `app_client`.
--
-- 0010_rls.sql was rewritten in place to create the final name, so a FRESH
-- database never sees the old one. This migration converges databases that
-- already applied 0010 (which recorded it as applied and will not re-run it).
--
-- WHY THE `0010a` NAME: it has to run BEFORE 0011. The runner applies files in
-- name order, and `applyRls` in table-engine.ts grants to `app_client` on
-- every table it creates as soon as `fc_has_read()` exists. A database that
-- stopped between 0010 and 0011 would otherwise reach 0011's createTable with
-- the role still named `desk_client` and die with "role app_client does not
-- exist" — never reaching a convergence migration numbered at the end.
-- `0010a` sorts after `0010_rls.sql` and before `0011_report.ts`.
--
-- Renaming is enough: policies and grants reference the role by OID, not by
-- name, so every `to desk_client` policy created by 0010/0055/0060 and by the
-- runtime DDL follows the rename automatically. Nothing is recreated.
--
-- The password is re-set explicitly: an MD5-hashed password is derived from
-- the role name, so PostgreSQL clears it on rename (SCRAM hashes survive).
-- Setting it unconditionally makes the outcome the same either way.
--
-- ROLES ARE CLUSTER-WIDE, POLICIES ARE PER-DATABASE. That asymmetry drives the
-- branching below: "both roles exist" is an ordinary state on a developer
-- cluster holding one converged database and one legacy one, so the question
-- that matters is not which roles exist but whether THIS database still binds
-- anything to the old one.

do $$
declare
  old_exists boolean := exists (select 1 from pg_roles where rolname = 'desk_client');
  new_exists boolean := exists (select 1 from pg_roles where rolname = 'app_client');
  old_refs   boolean := false;
begin
  if old_exists then
    select
      exists (select 1 from pg_policy where 'desk_client'::regrole = any (polroles))
      or exists (
        select 1 from information_schema.role_table_grants
        where grantee = 'desk_client' and table_schema = 'public'
      )
      into old_refs;
  end if;

  -- Already converged: 0010 just created app_client on a fresh database, or an
  -- earlier run of this migration did the rename.
  if not old_exists then
    if not new_exists then
      raise exception
        'RLS role app_client is missing and desk_client is not present either. '
        '0010_rls.sql should have created it, so it was most likely dropped by '
        'hand. Recreate it: create role app_client login password ''app_client''; '
        'grant usage on schema public to app_client;';
    end if;
    return;
  end if;

  -- The ordinary upgrade: one client role, still carrying the old name.
  if not new_exists then
    alter role desk_client rename to app_client;
    alter role app_client with login password 'app_client';
    return;
  end if;

  -- Both roles exist, but nothing in THIS database references the old one —
  -- another database on the same cluster is simply still on the old name.
  if not old_refs then
    return;
  end if;

  -- Both exist AND this database's policies still point at the old role. The
  -- rename cannot proceed (the target name is taken), and continuing would
  -- record a successful migration over RLS bound to a role nothing connects
  -- as. Fail loudly instead: the transaction rolls back and the migration
  -- stays pending.
  raise exception
    'Cannot converge the RLS role: this database still has policies or grants '
    'on desk_client, but app_client already exists on the cluster, so '
    'desk_client cannot be renamed into it. Resolve by hand — if app_client is '
    'unused, drop it and re-run; otherwise repoint this database''s policies.';
end $$;
