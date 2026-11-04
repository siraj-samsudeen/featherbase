-- Mandatory access is metadata, not an app-specific permission exception.
alter table featherbase.table_def add column if not exists access_policy jsonb;
