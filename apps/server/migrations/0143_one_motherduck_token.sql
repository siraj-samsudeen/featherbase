-- #969 / ADR 0020: one MotherDuck token for the whole instance.
-- A source that reached MotherDuck through a connection variable becomes a
-- MotherDuck source. A settings file names its databases; until then it attaches none.
update featherbase.data_source
  set engine = 'motherduck', url_env = null, access = 'read_only'
  where engine = 'duckdb' and (url_env = 'MOTHERDUCK_URL' or read_scaling_token);

-- Whatever a row says, a MotherDuck source is only ever read.
update featherbase.data_source set access = 'read_only' where engine = 'motherduck';

-- A source's database list holds names only: addresses come from what the token can read.
update featherbase.data_source d
  set databases = (select jsonb_agg(entry - 'address' - 'account' order by position) from jsonb_array_elements(d.databases) with ordinality as e(entry, position))
  where jsonb_typeof(d.databases) = 'array' and jsonb_array_length(d.databases) > 0;

drop table if exists featherbase.data_source_secret;

delete from featherbase.column_def
  where parent = 'Data Source' and column_name in ('read_scaling_token', 'token_last_four');
alter table featherbase.data_source drop column if exists read_scaling_token;
alter table featherbase.data_source drop column if exists token_last_four;

-- The settings file and the connect action set a source's databases through the
-- save, so the save checks them; the field stays out of the form.
update featherbase.column_def
  set read_only = false, description = 'The MotherDuck databases this source reads; only these are ever opened, read-only'
  where parent = 'Data Source' and column_name = 'databases';
