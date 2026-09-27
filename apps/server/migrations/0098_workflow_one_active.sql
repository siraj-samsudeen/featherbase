-- Deliberately fails if local data contains duplicates. Administrators must
-- choose which workflow to deactivate; migration must never choose for them.
create unique index workflow_one_active_per_table
  on featherbase.workflow (ref_table) where is_active = true;
