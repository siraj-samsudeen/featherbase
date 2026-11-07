-- #1020: how links to a Table's rows read. Next to title_column, which names the
-- rows it reads; every existing Table keeps name-and-code.
alter table featherbase.table_def
  add column link_format text not null default 'name_code'
  check (link_format in ('name_code', 'code_name', 'name', 'code'));
