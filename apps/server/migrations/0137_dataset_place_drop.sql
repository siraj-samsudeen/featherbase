-- #667: a person's scope place that an app dataset could not apply, as app
-- reads met it. A place naming a filter the dataset maps to no column adds no
-- rows (fail closed); this row lets Instance health say so. One row per app,
-- dataset, scope-providing app and set of unappliable filter keys, with when
-- it was first and last seen, per pair of the two apps' versions it was seen
-- under. Instance health counts only the current pair, so an upgrade of
-- either starts again, and a late read under older versions never replaces
-- a current record (Codex round 2 on #678).
--
-- No person, no place label and no filter value: who is affected is answered
-- only by the System Manager's read of one person's scope. Raw storage, never
-- a Table. No existing data is rewritten.
create table if not exists featherbase.dataset_place_drop (
  app              text        not null,
  dataset          text        not null,
  provider         text        not null,
  filter_keys      text[]      not null,
  app_version      text        not null,
  provider_version text        not null,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  primary key (app, dataset, provider, filter_keys, app_version, provider_version)
);
