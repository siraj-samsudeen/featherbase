-- @spec platform_storage_is_explicit.fresh_and_upgrade_converge_to_same_shape
-- Move platform-owned objects without replacing their OIDs. App schemas and
-- the pre-tenant public.site registry are intentionally outside this move.
create schema if not exists featherbase;

do $$
declare
  relation_name text;
  function_schema text;
begin
  if to_regclass('featherbase.site') is not null then
    raise exception 'featherbase.site conflicts with the intentional public.site registry';
  end if;

  create temporary table platform_move_set (relation_name text primary key) on commit drop;
  if to_regclass('public.table_def') is not null then
    insert into platform_move_set
    select distinct case lower(replace(name, ' ', '_'))
      when 'table' then 'table_def'
      when 'column' then 'column_def'
      else lower(replace(name, ' ', '_'))
    end
    from public.table_def
    where owner_app is null and data_source is null and kind <> 'settings';
  end if;
  insert into platform_move_set values
    ('access_token'), ('installed_app'), ('internal_metadata'), ('migration'),
    ('password_reset'), ('patch_log'), ('pre_auth_bucket'),
    ('sales_target_snapshot_row'), ('series'), ('single_value'), ('tag_link'),
    ('user_settings')
  on conflict do nothing;

  for relation_name in select p.relation_name from platform_move_set p order by p.relation_name loop
    if to_regclass(format('public.%I', relation_name)) is null then continue; end if;
    if to_regclass(format('featherbase.%I', relation_name)) is not null then
      raise exception 'destination relation featherbase.% already exists', relation_name;
    end if;
    execute format('alter table public.%I set schema featherbase', relation_name);
  end loop;

  foreach relation_name in array array['fc_session_user()', 'fc_has_read(text)'] loop
    select n.nspname into function_schema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.oid = coalesce(
      to_regprocedure('public.' || relation_name),
      to_regprocedure('featherbase.' || relation_name)
    );
    if function_schema = 'public' then
      execute format('alter function public.%s set schema featherbase', relation_name);
    elsif function_schema is not null and function_schema <> 'featherbase' then
      raise exception 'platform function % is unexpectedly in schema %', relation_name, function_schema;
    end if;
  end loop;
end $$;

create or replace function featherbase.fc_session_user() returns text
language sql stable
set search_path = pg_catalog
as $$
  select coalesce(nullif(current_setting('app.user', true), ''), 'Guest')
$$;

create or replace function featherbase.fc_has_read(tbl text) returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select featherbase.fc_session_user() = 'Administrator'
    or exists (
      select 1
      from featherbase.permission p
      join featherbase.has_role hr
        on hr.role = p.role
       and hr.parenttype = 'User'
       and hr.parent = featherbase.fc_session_user()
      where p.ref_table = tbl
        and coalesce(p.tier, 'basic') = 'basic'
        and p.can_read
    )
$$;

-- Relations retain their ACLs when moved. Preserve those grants' effective
-- reachability too: public had USAGE for every role, so the destination must
-- retain USAGE while CREATE remains owner-only. Table ACLs and RLS continue
-- to decide which objects and rows each role can access.
grant usage on schema featherbase to public;
revoke create on schema featherbase from public;
