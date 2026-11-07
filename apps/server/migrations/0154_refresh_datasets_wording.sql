-- #731: the refresh_datasets description named one client's warehouse. Say
-- what the job does on any instance. Only the shipped wording is replaced, so
-- an administrator's own description stays.
update featherbase.scheduled_job
set description = 'Rebuild every dataset snapshot a report has asked for, on this job''s cadence. A report that finds no snapshot also wakes this job at once, so it never waits a full period.'
where row_id = 'refresh_datasets'
  and description = 'Rebuild every dataset snapshot a report has asked for. Four-hourly to follow the warehouse fleet grid an hour behind its dbt build (data-warehouse #3036/#3082); a cache miss also wakes this job immediately, so a new report never waits a full period.';
