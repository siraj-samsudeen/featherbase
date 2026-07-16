-- PERM-004: generated row-level security.
--
-- Local equivalent of Supabase's PostgREST + RLS setup: a `desk_client`
-- login role models a direct (non-server) client connection. The session
-- user travels in the `app.user` GUC — the analogue of PostgREST setting
-- request.jwt.claims from a verified JWT; the trusted connection layer is
-- responsible for setting it. SELECT policies are generated per DocType
-- table from DocPerm; no INSERT/UPDATE/DELETE policies (and no grants)
-- exist, so every direct write is denied. The app server connects as the
-- table owner (postgres) and bypasses RLS — it remains the only write path,
-- running the full document lifecycle.

do $$ begin
  if not exists (select from pg_roles where rolname = 'desk_client') then
    create role desk_client login password 'desk_client';
  end if;
end $$;

grant usage on schema public to desk_client;

create or replace function fc_session_user() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('app.user', true), ''), 'Guest')
$$;

-- Security definer: runs as the owner (postgres), so it can consult
-- tab_docperm / tab_has_role without tripping their own RLS policies.
create or replace function fc_has_read(dt text) returns boolean
language sql stable security definer set search_path = public
as $$
  select fc_session_user() = 'Administrator'
    or exists (
      select 1
      from tab_docperm p
      join tab_has_role hr
        on hr.role = p.role
       and hr.parenttype = 'User'
       and hr.parent = fc_session_user()
      where p.ref_doctype = dt
        and coalesce(p.permlevel, 0) = 0
        and p.can_read
    )
$$;

-- Enable RLS with a SELECT-only policy on every existing DocType table.
-- Child tables gate row-by-row on the owning parent DocType's read perm.
do $$
declare
  r record;
  tbl text;
begin
  -- Snapshot first: looping directly over tab_doctype keeps a cursor open
  -- on it, which blocks the ALTER TABLE on tab_doctype itself (55006).
  create temp table _rls_doctypes on commit drop as
    select name, istable from tab_doctype where not issingle;
  for r in select name, istable from _rls_doctypes loop
    tbl := 'tab_' || regexp_replace(lower(r.name), '\s+', '_', 'g');
    if to_regclass(tbl) is null then
      continue;
    end if;
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists fc_select on %I', tbl);
    if r.istable then
      execute format(
        'create policy fc_select on %I for select to desk_client using (fc_has_read(parenttype))',
        tbl);
    else
      execute format(
        'create policy fc_select on %I for select to desk_client using (fc_has_read(%L))',
        tbl, r.name);
    end if;
    execute format('grant select on %I to desk_client', tbl);
  end loop;
end $$;
