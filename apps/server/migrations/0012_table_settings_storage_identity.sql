-- #860: Table definitions are named by their natural key, not their module.
-- Keep authored defaults and effective Metadata Overrides unchanged.
UPDATE featherbase.table_def SET title_column = 'name'
WHERE name = 'Table' AND (title_column IS NULL OR title_column = '');
