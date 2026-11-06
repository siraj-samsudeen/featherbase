-- #1021: a Table can be a view, a named filtered lens on another Table. It
-- holds no rows of its own: its rows are the base Table's rows its filters
-- match. A base that still has a view cannot go (no ON DELETE); a rename of
-- the base moves its views with it (moveTable repoints view_of).
alter table featherbase.table_def
  add column if not exists view_of text references featherbase.table_def(name),
  add column if not exists view_filters jsonb;

alter table featherbase.table_def drop constraint if exists table_def_view_shape;
alter table featherbase.table_def add constraint table_def_view_shape
  check ((kind = 'view') = (view_of is not null) and (view_of is null or view_filters is not null));
