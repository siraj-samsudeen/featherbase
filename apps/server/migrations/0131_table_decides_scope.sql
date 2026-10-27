-- #559 (design E1): a Table whose rows decide which places people cover is
-- marked by its own definition, not by a platform list of names. Writing a
-- marked Table's rows is System Manager work whatever the Permission rows say
-- (security-tables.ts), and only a marked Table can be read by an app's scope
-- provider. Adds a column with a default; no existing row changes meaning.
alter table featherbase.table_def add column if not exists decides_scope boolean not null default false;

-- The Table Table describes itself, so the mark is a selectable field.
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only)
select 'Table', 10, 'decides_scope', 'Decides people''s scope', 'Check', true
where not exists (
  select 1 from featherbase.column_def where parent = 'Table' and column_name = 'decides_scope'
);
