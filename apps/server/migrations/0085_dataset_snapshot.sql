-- Query-grained analytical dataset snapshots (data-warehouse #3755 follow-on,
-- openspec/changes/query-grained-dataset-snapshots; contract siraj-samsudeen#281).
--
-- These tables are APP-INTERNAL on purpose: they are not `table_def` Tables and
-- are never reachable through the generic list/document APIs. A snapshot holds
-- the published query MINUS its personalisation predicate — i.e. every store's
-- rows in one place — and Featherbase's row scoping is fail-open for a principal
-- with no `data_scope` rows (query.ts:180 `if (upMap.size)`, no test covers the
-- empty case; #246 proposes `scope_required` and is not implemented). Exposing a
-- superset snapshot through the generic path would therefore hand one employee
-- every store. Reads go through the app's own route, which applies the caller's
-- assignment as a predicate. Revisit when #246 lands.

create table if not exists dataset_snapshot (
  row_id             text primary key,
  dataset            text        not null,
  definition_version text        not null,
  -- The warehouse's own as-of, not the build time: honest staleness (ADR 1674).
  source_as_of       date,
  built_at           timestamptz not null default now(),
  activated_at       timestamptz,
  row_count          integer,
  -- building -> active -> superseded, or building -> failed. A process that
  -- dies mid-build leaves 'building', which no reader resolves: an interrupted
  -- refresh is quarantined by construction rather than by cleanup.
  status             text        not null default 'building',
  error              text
);

-- One active snapshot per dataset, enforced by the database rather than by the
-- activation code remembering to demote the previous one.
create unique index if not exists dataset_snapshot_one_active
  on dataset_snapshot (dataset) where status = 'active';

create index if not exists dataset_snapshot_dataset_status
  on dataset_snapshot (dataset, status);

-- Day grain per store x subcategory. Day and not month because the report's
-- cutoff is least(period_end, max(actuals_as_of_date)) and moves: a month total
-- cannot answer a moving cutoff, so the snapshot sits BELOW the display grain
-- and the report re-aggregates at read time.
create table if not exists sales_target_snapshot_row (
  snapshot_id    text    not null references dataset_snapshot(row_id) on delete cascade,
  plant_code     text    not null,
  store_name     text,
  short_code     text,
  hierarchy_code text    not null,
  subcategory    text,
  business_date  date    not null,
  target_before_tax numeric,
  actual_before_tax numeric
);

-- The read path is always (snapshot, store, subcategory set), so the index
-- leads with exactly that.
create index if not exists sales_target_snapshot_row_scope
  on sales_target_snapshot_row (snapshot_id, plant_code, hierarchy_code);

-- Publish-before-cache: a report whose dataset has no active snapshot serves
-- live and records the ask here; the refresh worker materialises what was
-- actually asked for. This is what replaces a hand-maintained registry of
-- source tables, windows and cadences.
create table if not exists dataset_miss (
  row_id     text primary key,
  dataset    text        not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       integer     not null default 1
);

create unique index if not exists dataset_miss_dataset on dataset_miss (dataset);
