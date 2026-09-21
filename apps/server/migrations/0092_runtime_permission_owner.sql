alter table permission add column if not exists owner_app text;

-- Runtime packages installed before this column already recorded every grant
-- they created in installed_app.perms. Recover that ownership so upgrading
-- cannot turn package-scoped access into a permanent core grant.
update permission p
set owner_app = app.name
from installed_app app,
  lateral jsonb_array_elements_text(app.perms) owned_permission(row_id)
where app.runtime_package = true
  and p.row_id = owned_permission.row_id
  and p.owner_app is null;

-- Older provisioning adopted an equivalent grant created by another package,
-- so the later package had no ledger entry to backfill. Reconstruct every
-- runtime manifest's declaration as its own owned contribution. An unowned
-- permission that predated all packages remains untouched and independently
-- active.
with declarations as (
  select app.name as owner_app, declared.definition
  from installed_app app
  cross join lateral jsonb_array_elements(
    coalesce(app.manifest->'permissions', '[]'::jsonb)
  ) as declared(definition)
  where app.runtime_package = true and app.manifest is not null
), inserted as (
  insert into permission (
    row_id, ref_table, role, tier, own_rows_only,
    can_read, can_write, can_create, can_delete,
    can_submit, can_cancel, can_amend, owner_app
  )
  select
    'runtime-permission-' || md5(
      d.owner_app || ':' || (d.definition->>'table') || ':' ||
      (d.definition->>'role') || ':' || coalesce(d.definition->>'tier', 'basic')
    ),
    d.definition->>'table', d.definition->>'role',
    coalesce(d.definition->>'tier', 'basic'),
    coalesce((d.definition->>'own_rows_only')::boolean, false),
    coalesce((d.definition->>'can_read')::boolean, false),
    coalesce((d.definition->>'can_write')::boolean, false),
    coalesce((d.definition->>'can_create')::boolean, false),
    coalesce((d.definition->>'can_delete')::boolean, false),
    coalesce((d.definition->>'can_submit')::boolean, false),
    coalesce((d.definition->>'can_cancel')::boolean, false),
    coalesce((d.definition->>'can_amend')::boolean, false),
    d.owner_app
  from declarations d
  where not exists (
    select 1 from permission p
    where p.ref_table = d.definition->>'table'
      and p.role = d.definition->>'role'
      and p.tier = coalesce(d.definition->>'tier', 'basic')
      and p.owner_app = d.owner_app
  )
  returning row_id, owner_app
), added as (
  select owner_app, jsonb_agg(row_id) as row_ids from inserted group by owner_app
)
update installed_app app
set perms = app.perms || added.row_ids
from added
where app.name = added.owner_app;
