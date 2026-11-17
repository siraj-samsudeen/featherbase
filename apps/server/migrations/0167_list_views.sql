-- #1259: a list can be read in three views. A saved view keeps the view it was
-- saved in (null: the person's own choice for the Table), and a Table can be
-- marked as a queue, whose lists open on cards (List And Record).
alter table featherbase.saved_view add column if not exists layout text;
alter table featherbase.saved_view drop constraint if exists saved_view_layout_known;
alter table featherbase.saved_view add constraint saved_view_layout_known check (layout is null or layout in ('table', 'split', 'panel'));
alter table featherbase.table_def add column if not exists queue boolean not null default false;
