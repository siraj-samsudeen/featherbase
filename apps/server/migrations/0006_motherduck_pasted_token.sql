-- #772 / ADR 0018: a MotherDuck source connected by pasting its token.
-- The encrypted token lives in its own table with no column_def, so no generic
-- read, list or save can ever reach it; the source shows only its last four.
-- `databases` holds the databases chosen for the source, [{name, address, owner}];
-- the source attaches only these (design D2). The catalog keeps each database's
-- table list until someone refreshes it (design D3).
alter table featherbase.data_source add column if not exists token_last_four varchar(4);
alter table featherbase.data_source add column if not exists databases jsonb;

create table if not exists featherbase.data_source_secret (
  data_source varchar(140) primary key
    references featherbase.data_source (row_id) on delete cascade on update cascade,
  token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table if not exists featherbase.data_source_catalog (
  data_source varchar(140) not null
    references featherbase.data_source (row_id) on delete cascade on update cascade,
  database varchar(140) not null,
  tables jsonb not null,
  listed_at timestamptz not null default now(),
  primary key (data_source, database)
);

update featherbase.column_def set choices = E'postgres\nmysql\nduckdb\nmotherduck\ncsv-folder'
  where parent = 'Data Source' and column_name = 'engine';

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Data Source', 13, 'token_last_four', 'Token ends in', 'Data', null, false, false, true, false, false, 'basic', 'Table', 'columns', false,
       'The last four characters of a pasted MotherDuck token; the token itself is stored encrypted and never shown'
where not exists (select 1 from featherbase.column_def where parent = 'Data Source' and column_name = 'token_last_four');

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Data Source', 14, 'databases', 'Databases', 'JSON', null, false, false, true, false, false, 'basic', 'Table', 'columns', false,
       'The MotherDuck databases this source reads; only these are ever opened'
where not exists (select 1 from featherbase.column_def where parent = 'Data Source' and column_name = 'databases');
