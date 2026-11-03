-- #740: coordinated after the presentation migrations; recheck order before landing.
-- Settings records are assigned IDs; existing IDs are never rewritten.
update featherbase.table_def set id_pattern = 'hash'
where name = 'Metadata Override' and id_pattern = 'prompt';

-- Only known platform defaults converge. Preserve custom wording and overlays.
-- #826 may have replaced the raw property/value defaults before this migration.
update featherbase.column_def set label = 'Table'
where parent = 'Metadata Override' and column_name = 'table_name' and label = 'doc_type';
update featherbase.column_def set label = 'Column'
where parent = 'Metadata Override' and column_name = 'column_name' and label = 'field_name';
update featherbase.column_def set label = 'Setting'
where parent = 'Metadata Override' and column_name = 'property' and label in ('property', 'Property');
update featherbase.column_def set label = 'Value'
where parent = 'Metadata Override' and column_name = 'value' and label in ('value', 'Value');
