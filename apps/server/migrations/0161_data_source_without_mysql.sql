-- #1199 / ADR 0025: MySQL is no longer a supported data source. Data
-- Source's engine stops offering it; a source saved on it before this is
-- refused by name when used (sources/registry.ts), not by this migration.
update featherbase.column_def
  set choices = array_to_string(array_remove(string_to_array(choices, E'\n'), 'mysql'), E'\n')
  where parent = 'Data Source' and column_name = 'engine';

-- As 0007 did, change only the platform's own label map; authored and
-- custom maps survive (a label for a choice no longer offered is inert).
update featherbase.column_def
  set choice_labels = choice_labels - 'mysql'
  where parent = 'Data Source' and column_name = 'engine' and not custom
    and choice_labels = '{"postgres":"PostgreSQL","mysql":"MySQL","duckdb":"DuckDB","motherduck":"MotherDuck","csv-folder":"CSV folder"}'::jsonb;
