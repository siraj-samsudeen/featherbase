-- #731: the leaver check left the platform; it is Dash's job dash.disable_leavers
-- now, shipped off. The platform's schedule and anything it queued go.
delete from featherbase.background_job where method = 'disable_leavers' and job_status = 'queued';
delete from featherbase.scheduled_job where row_id = 'disable_leavers' and owner_app is null;
