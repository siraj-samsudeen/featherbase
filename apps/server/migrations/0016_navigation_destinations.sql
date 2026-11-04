-- #873: navigation pointers are not recorded testimony. Never backfill events.
alter table featherbase.table_def add column navigation_identity uuid not null default gen_random_uuid();
alter table featherbase.table_def add constraint table_navigation_identity_unique
  unique (navigation_identity) deferrable initially immediate;
alter table featherbase.user_event add column destination jsonb;

create table featherbase.navigation_row_target (
  id uuid primary key default gen_random_uuid(),
  table_identity uuid not null,
  row_id text not null,
  born_at timestamptz not null,
  retired boolean not null default false
);
create unique index navigation_row_live on featherbase.navigation_row_target(table_identity, row_id) where not retired;
