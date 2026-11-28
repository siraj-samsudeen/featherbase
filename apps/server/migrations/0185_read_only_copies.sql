-- #1418: a Copied table has a mode. Editable (#772, every existing row) is
-- copied from a whole warehouse table, row by row, and people may correct it.
-- Read-only is declared by an app: loaded whole from a query, per run, and
-- nobody edits it, and it loads only when someone asks (design D5, as ruled
-- 28-Nov-2026). Its loads live in featherbase_copy, one partition each; the
-- Table people read is a view of the active load (design D1).
alter table featherbase.table_copy
  add column if not exists mode text not null default 'editable',
  -- The query, with {name} placeholders the run check's answer fills.
  add column if not exists query text,
  -- A one-row query naming the current run; a load follows a new answer.
  add column if not exists run_key_query text,
  -- The run check's answer the active load was made from, as JSON text.
  add column if not exists last_run_key text;

alter table featherbase.table_copy drop constraint if exists table_copy_mode_check;
alter table featherbase.table_copy add constraint table_copy_mode_check check (mode in ('editable', 'read_only'));

-- An editable copy names its source, warehouse table and key; a read-only one
-- its query. A read-only copy's source is the one its app declares by name,
-- which an administrator connects after the install, so it holds no link to
-- a Data Source row (the description of its Table names it).
alter table featherbase.table_copy
  alter column data_source drop not null,
  alter column database drop not null,
  alter column source_schema drop not null,
  alter column source_table drop not null,
  alter column key_column drop not null;
alter table featherbase.table_copy drop constraint if exists table_copy_source_check;
alter table featherbase.table_copy add constraint table_copy_source_check check (
  case mode
    when 'editable' then data_source is not null and database is not null and source_schema is not null and source_table is not null and key_column is not null
    else query is not null and data_source is null
  end);

create schema if not exists featherbase_copy;
