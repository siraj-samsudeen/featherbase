-- A worker with no handler for a scheduled job hands the run back for a while
-- instead of failing it: during a deploy, the previous deployment's worker may
-- claim a job the new release just switched on. This is when that run was
-- first handed back; after 30 minutes it fails as an unknown job.
alter table featherbase.background_job add column if not exists handed_back_at timestamp with time zone;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Background Job', 10, 'handed_back_at', 'Handed back since', 'Datetime', false, false, true, false, false, 'basic', 'Table', 'columns', false,
       'When a server with no handler for this scheduled job first handed the run back for another to take. After 30 minutes it fails.'
where not exists (select 1 from featherbase.column_def where parent = 'Background Job' and column_name = 'handed_back_at');
