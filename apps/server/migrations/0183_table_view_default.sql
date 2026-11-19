-- #1282 A4: a Table's default view, set by a System Manager from the View menu.
-- One row per save, never changed: the latest row for a Table is its default,
-- and Undo adds a row that puts the one before back (`undoes` names the save it
-- undid). Empty settings mean the platform's own built-in.
create table if not exists featherbase.table_view_default (
  row_id varchar(140) primary key,
  ref_table varchar(140) not null,
  settings jsonb not null,
  undoes varchar(140),
  created_by varchar(140) not null,
  -- The moment of the save itself, so saves in one transaction still keep their order.
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists table_view_default_latest on featherbase.table_view_default (ref_table, created_at desc, row_id desc);
