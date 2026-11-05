-- #927: keep a master Table in step with a copied warehouse table.
-- One rule per copied table; the last source values seen per linked row; and
-- every difference raised, so a re-run never raises the same one twice.
create table if not exists featherbase.master_sync (
  copied_table varchar(140) primary key references featherbase.table_copy(target_table) on update cascade on delete cascade,
  rule jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by varchar(140) not null,
  last_synced_at timestamptz,
  last_run_id varchar(140)
);
create table if not exists featherbase.master_sync_snapshot (
  copied_table varchar(140) not null references featherbase.master_sync(copied_table) on update cascade on delete cascade,
  source_key varchar(140) not null,
  master_row varchar(140) not null,
  source_values jsonb not null,
  seen_at timestamptz not null default now(),
  primary key (copied_table, source_key)
);
create table if not exists featherbase.master_sync_difference (
  copied_table varchar(140) not null references featherbase.master_sync(copied_table) on update cascade on delete cascade,
  fingerprint varchar(64) not null,
  kind varchar(40) not null,
  source_key varchar(140) not null,
  master_row varchar(140),
  column_name varchar(140),
  source_value text,
  featherbase_value text,
  ticket_app varchar(140) not null,
  ticket_payload jsonb not null,
  ticket varchar(140),
  ticket_error text,
  run_id varchar(140) not null,
  raised_at timestamptz not null default now(),
  primary key (copied_table, fingerprint)
);
