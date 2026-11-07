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

-- The Table list names views and what they are views of.
update featherbase.column_def set choices = choices || E'\nview'
where parent = 'Table' and column_name = 'kind' and choices is not null
  and not ('view' = any(string_to_array(replace(choices, E'\r', ''), E'\n')));
update featherbase.column_def set choice_labels = choice_labels || '{"view":"View"}'::jsonb
where parent = 'Table' and column_name = 'kind' and choice_labels is not null;
-- Data, not a Reference: Table rows live in table_def, and link sweeps expect
-- a Reference's target to have storage of its own.
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only, description)
select 'Table', coalesce((select max(position) from featherbase.column_def where parent = 'Table'), 0) + 1,
  'view_of', 'View of', 'Data', true, 'The Table this view shows rows of: the ones its filter matches.'
where not exists (select 1 from featherbase.column_def where parent = 'Table' and column_name = 'view_of');
