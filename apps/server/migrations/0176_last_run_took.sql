-- #1348 (folded in by the UI owner): a Scheduled Job's last run time reads "Last Run Took" (shown as
-- "1 min 5 s", never a count of milliseconds). Only the generated label changes; an administrator's own stays.
update featherbase.column_def set label = 'Last Run Took'
where parent = 'Scheduled Job' and column_name = 'last_duration_ms'
  and (label is null or label in ('', 'Last Duration MS', 'Last Duration Ms'));
