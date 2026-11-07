-- #246: a Table names the Reference columns its Data Scope narrows by
-- (scope_on; null keeps every Reference), and can refuse a person with no
-- Data Scope on those dimensions instead of showing every row (scope_required).
alter table featherbase.table_def add column if not exists scope_on text[];
alter table featherbase.table_def add column if not exists scope_required boolean not null default false;
