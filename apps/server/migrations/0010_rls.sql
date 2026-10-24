-- PERM-004: generated row-level security.
--
-- Local equivalent of Supabase's PostgREST + RLS setup. The session user
-- travels in the `app.user` GUC — the analogue of PostgREST setting
-- request.jwt.claims from a verified JWT; the trusted connection layer is
-- responsible for setting it. SELECT policies are generated per Table from
-- Permission and apply to every role but the table owner; no
-- INSERT/UPDATE/DELETE policies exist, so every direct write is denied. No
-- role is granted SELECT either: the app server connects as the table owner
-- (postgres), bypasses RLS and remains the only read and write path, running
-- the full row lifecycle. The RLS suite exercises the policies through a role
-- it creates for its own run.

create or replace function fc_session_user() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('app.user', true), ''), 'Guest')
$$;

-- Security definer: runs as the owner (postgres), so it can consult
-- permission / has_role without tripping their own RLS policies.
create or replace function fc_has_read(tbl text) returns boolean
language sql stable security definer set search_path = public
as $$
  select fc_session_user() = 'Administrator'
    or exists (
      select 1
      from permission p
      join has_role hr
        on hr.role = p.role
       and hr.parenttype = 'User'
       and hr.parent = fc_session_user()
      where p.ref_table = tbl
        and coalesce(p.tier, 'basic') = 'basic'
        and p.can_read
    )
$$;

-- Enable RLS with a SELECT-only policy on every existing Table.
-- Sub-tables gate row-by-row on the owning parent Table's read perm.
do $$
declare
  r record;
  tbl text;
begin
  -- Snapshot first: looping directly over table_def keeps a cursor open on
  -- it, which blocks the ALTER TABLE on table_def itself (55006).
  create temp table _rls_tables on commit drop as
    select name, kind from table_def where kind != 'settings';
  for r in select name, kind from _rls_tables loop
    tbl := regexp_replace(lower(r.name), '\s+', '_', 'g');
    if to_regclass(tbl) is null then
      continue;
    end if;
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists fc_select on %I', tbl);
    if r.kind = 'sub_table' then
      execute format(
        'create policy fc_select on %I for select using (fc_has_read(parenttype))',
        tbl);
    else
      execute format(
        'create policy fc_select on %I for select using (fc_has_read(%L))',
        tbl, r.name);
    end if;
  end loop;
end $$;
