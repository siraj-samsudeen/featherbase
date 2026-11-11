-- #1199 / ADR 0025: MySQL is no longer a supported data source. Data
-- Source's engine stops offering it; a source saved on it before this is
-- refused by name when used (sources/registry.ts), not by this migration.
update featherbase.column_def
  set choices = array_to_string(array_remove(string_to_array(choices, E'\n'), 'mysql'), E'\n'),
      choice_labels = choice_labels - 'mysql'
  where parent = 'Data Source' and column_name = 'engine';
