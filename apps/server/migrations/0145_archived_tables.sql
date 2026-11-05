-- #905: a table can be archived: still readable, no longer written, out of
-- everyday menus. When, by whom and what replaced it, on its definition.
alter table featherbase.table_def add column if not exists archived_at timestamp with time zone;
alter table featherbase.table_def add column if not exists archived_by character varying(140);
alter table featherbase.table_def add column if not exists archived_note text;
