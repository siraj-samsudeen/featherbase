-- #451: the `app_client` login role goes. It modelled a direct database
-- client, and only Query Reports and the RLS suite ever connected as it; the
-- generated RLS policies now apply to every role but the table owner, and no
-- role is granted access, so nothing needs it.
--
-- ROLES ARE CLUSTER-WIDE, POLICIES AND GRANTS ARE PER-DATABASE. This database
-- converges its own objects: policies that targeted only the role are
-- retargeted to every role (what a fresh database creates), then DROP OWNED
-- revokes the role's grants here. The role itself is dropped when no other
-- database on the cluster still depends on it; otherwise it is made unable to
-- sign in, and the last database to run this migration drops it. A database
-- that never had the role, or where it owns nothing, passes unchanged.
do $$
declare
  client oid := (select oid from pg_roles where rolname = 'app_client');
  r record;
begin
  if client is null then
    return;
  end if;

  for r in
    select p.polname, n.nspname, c.relname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.polroles = array[client]
  loop
    execute format('alter policy %I on %I.%I to public', r.polname, r.nspname, r.relname);
  end loop;

  execute 'drop owned by app_client';

  if exists (
    select 1 from pg_shdepend
    where refclassid = 'pg_authid'::regclass and refobjid = client
      and dbid <> (select oid from pg_database where datname = current_database())
  ) then
    alter role app_client nologin password null;
    raise notice 'app_client is still referenced by another database on this cluster; it can no longer sign in and is dropped when that database runs this migration';
  else
    drop role app_client;
  end if;
end $$;
