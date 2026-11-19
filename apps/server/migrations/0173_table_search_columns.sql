-- #1346: a Table can name more columns that search matches, besides a row's
-- key and title (Frappe's search fields). A person found by their warehouse
-- login, a person found by an employee code: each Table says which of its own
-- columns, so nothing is written per model.
alter table featherbase.table_def add column if not exists search_columns text[];
