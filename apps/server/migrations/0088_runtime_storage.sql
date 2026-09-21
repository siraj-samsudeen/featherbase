alter table table_def add column label text;
alter table table_def add column owner_app text;
alter table table_def add column physical_schema text;
alter table table_def add column physical_relation text;
alter table table_def add constraint app_storage_complete check (
  (owner_app is null and physical_schema is null and physical_relation is null)
  or (owner_app is not null and physical_schema is not null and physical_relation is not null)
);
create unique index app_storage_location on table_def (physical_schema, physical_relation)
  where owner_app is not null;
