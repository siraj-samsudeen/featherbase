-- #914: Data Source's column labels read in sentence case, like every other
-- label. Presentation only. A label someone has already changed is kept: only
-- the baseline's exact Title Case text is replaced.
UPDATE featherbase.column_def AS c
SET label = l.label, updated_at = now()
FROM (VALUES
  ('url_env', 'Connection Env Var', 'Connection env var'),
  ('root_path', 'Root Path (csv-folder)', 'Root path (csv-folder)'),
  ('default_schema', 'Default Schema', 'Default schema'),
  ('pool_max', 'Pool Max', 'Pool max'),
  ('statement_timeout_ms', 'Statement Timeout (ms)', 'Statement timeout (ms)'),
  ('table_allowlist', 'Table Allowlist', 'Table allowlist'),
  ('conn_status', 'Connection Status', 'Connection status'),
  ('last_checked_at', 'Last Checked At', 'Last checked at'),
  ('last_error', 'Last Error', 'Last error')
) AS l(column_name, old_label, label)
WHERE c.parent = 'Data Source' AND c.column_name = l.column_name AND c.label = l.old_label;
