-- #881: a link column whose Table is chosen per row. It names the column of
-- its own Table that holds the target Table's name (a link to Table); null
-- for every other column.
alter table featherbase.column_def add column if not exists table_column text;
