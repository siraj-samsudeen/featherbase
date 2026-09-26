-- Move platform-owned objects without replacing their OIDs. App schemas and
-- the pre-tenant public.site registry are intentionally outside this move.
create schema if not exists featherbase;

do $$
declare
  platform_relation record;
  function_signature text;
  function_schema text;
begin
  if to_regclass('featherbase.site') is not null then
    raise exception 'featherbase.site conflicts with the intentional public.site registry';
  end if;

  create temporary table platform_move_set (
    relation_name text primary key,
    required boolean not null
  ) on commit drop;
  if to_regclass('public.table_def') is not null then
    insert into platform_move_set
    select distinct case lower(regexp_replace(name, '[[:space:]]+', '_', 'g'))
      when 'table' then 'table_def'
      when 'column' then 'column_def'
      else lower(regexp_replace(name, '[[:space:]]+', '_', 'g'))
    end, true
    from public.table_def
    where owner_app is null and data_source is null and kind <> 'settings';
  end if;
  insert into platform_move_set values
    ('access_token', false), ('installed_app', false), ('internal_metadata', false),
    ('migration', false), ('password_reset', false), ('patch_log', false),
    ('pre_auth_bucket', false), ('sales_target_snapshot_row', false),
    ('series', false), ('single_value', false), ('tag_link', false),
    ('user_settings', false)
  on conflict (relation_name) do update
    set required = platform_move_set.required or excluded.required;

  for platform_relation in select * from platform_move_set order by relation_name loop
    if to_regclass(format('public.%I', platform_relation.relation_name)) is null then
      if platform_relation.required
         and to_regclass(format('featherbase.%I', platform_relation.relation_name)) is null then
        raise exception 'required platform relation public.% is missing', platform_relation.relation_name;
      end if;
      continue;
    end if;
    if to_regclass(format('featherbase.%I', platform_relation.relation_name)) is not null then
      raise exception 'destination relation featherbase.% already exists', platform_relation.relation_name;
    end if;
    execute format('alter table public.%I set schema featherbase', platform_relation.relation_name);
  end loop;

  foreach function_signature in array array['fc_session_user()', 'fc_has_read(text)'] loop
    select n.nspname into function_schema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.oid = coalesce(
      to_regprocedure('public.' || function_signature),
      to_regprocedure('featherbase.' || function_signature)
    );
    if function_schema = 'public' then
      execute format('alter function public.%s set schema featherbase', function_signature);
    elsif function_schema is not null and function_schema <> 'featherbase' then
      raise exception 'platform function % is unexpectedly in schema %', function_signature, function_schema;
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
