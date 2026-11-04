-- #772 part 2: a Featherbase table copied from a warehouse table. One row per
-- copied table says where it was copied from and which column matches rows on
-- every copy; each column's source is its column_def.source_column, so renaming
-- a column never breaks the next copy.
create table if not exists featherbase.table_copy (
  target_table varchar(140) primary key,
  data_source varchar(140) not null
    references featherbase.data_source (row_id) on update cascade,
  database varchar(140) not null,
  source_schema varchar(140) not null,
  source_table varchar(140) not null,
  key_column varchar(140) not null,
  last_copied_at timestamptz,
  last_run_id varchar(140)
);
