-- META-012: Table and Column describe themselves — their own rows live in
-- table_def/column_def, the same generic store every other Table uses.
-- Column is a sub-table of Table.

insert into table_def (name, module, id_pattern, kind) values
  ('Table', 'Core', 'prompt', 'table'),
  ('Column', 'Core', 'hash', 'sub_table');

insert into column_def (parent, position, column_name, label, column_type, choices, row_table, reqd, in_list_view) values
  ('Table', 1, 'module', 'Module', 'Data', null, null, false, true),
  ('Table', 2, 'kind', 'Kind', 'Choice', E'table\nsub_table\nsettings', null, false, false),
  ('Table', 3, 'is_submittable', 'Is Submittable', 'Check', null, null, false, false),
  ('Table', 4, 'id_pattern', 'ID Pattern', 'Data', null, null, false, false),
  ('Table', 5, 'title_column', 'Title Column', 'Data', null, null, false, false),
  ('Table', 6, 'description', 'Description', 'Text', null, null, false, false),
  ('Table', 7, 'columns', 'Columns', 'Sub-table', null, 'Column', false, false),
  ('Table', 8, 'system', 'System', 'Check', null, null, false, false),
  ('Column', 1, 'column_name', 'Column Name', 'Data', null, null, true, true),
  ('Column', 2, 'label', 'Label', 'Data', null, null, false, true),
  ('Column', 3, 'column_type', 'Column Type', 'Choice',
    E'Data\nInt\nFloat\nCurrency\nCheck\nChoice\nDate\nDatetime\nText\nLong Text\nReference\nSub-table\nAttach\nAttach Image\nJSON\nSection Break\nColumn Break',
    null, true, true),
  ('Column', 4, 'reference_table', 'Reference Table', 'Data', null, null, false, false),
  ('Column', 5, 'choices', 'Choices', 'Text', null, null, false, false),
  ('Column', 6, 'row_table', 'Row Table', 'Data', null, null, false, false),
  ('Column', 7, 'reqd', 'Required', 'Check', null, null, false, false),
  ('Column', 8, 'unique', 'Unique', 'Check', null, null, false, false),
  ('Column', 9, 'default_value', 'Default', 'Data', null, null, false, false),
  ('Column', 10, 'read_only', 'Read Only', 'Check', null, null, false, false),
  ('Column', 11, 'hidden', 'Hidden', 'Check', null, null, false, false),
  ('Column', 12, 'in_list_view', 'In List View', 'Check', null, null, false, false),
  ('Column', 13, 'tier', 'Tier', 'Choice', E'basic\nrestricted', null, false, false);
