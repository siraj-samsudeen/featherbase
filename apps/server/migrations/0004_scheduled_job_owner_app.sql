-- #700: the app whose manifest declares a Scheduled Job; null for the
-- platform's own jobs. Kept out of the editable metadata (no column_def),
-- like permission.owner_app, so Admin can never reassign a job to another app.
alter table featherbase.scheduled_job add column if not exists owner_app text;
