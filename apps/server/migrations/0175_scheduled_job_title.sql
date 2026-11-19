-- #1330: a Scheduled Job reads by a title, never its code ("check_sla"). The
-- Title becomes the Table's title column; `method` stays the job's identity.
alter table featherbase.scheduled_job add column if not exists title text;

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reqd, "unique",
  read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Scheduled Job', 0, 'title', 'Title', 'Data', false, false,
  false, false, true, 'basic', 'Table', 'columns', false,
  'What the job does, in words: how it reads in lists, links and Recently Opened.'
where not exists (select 1 from featherbase.column_def where parent = 'Scheduled Job' and column_name = 'title');

update featherbase.table_def set title_column = 'title' where name = 'Scheduled Job';

-- The platform's own jobs, each named for what it does. Only an empty title is
-- filled, so an administrator's own wording stays.
update featherbase.scheduled_job j set title = t.title
from (values
  ('auto_email_reports', 'Email Scheduled Reports'),
  ('check_instance_health', 'Check Instance Health'),
  ('check_sla', 'Escalate SLA Breaches'),
  ('disable_leavers', 'Disable Leavers'),
  ('link_roster', 'Link the Staff Roster'),
  ('refresh_datasets', 'Refresh Datasets'),
  ('refresh_leaver_sign_in', 'Refresh Leavers Who Can Still Sign In'),
  ('remind_access_requests', 'Remind About Access Requests'),
  ('sync_motherduck_accounts', 'Sync MotherDuck Accounts')
) as t(method, title)
where j.method = t.method and coalesce(j.title, '') = '';

-- A copied table's refresh reads by the table it refreshes, never its code
-- ("copy_refresh_3f…" -> "Refresh Copy of Store Master").
update featherbase.scheduled_job j set title = 'Refresh Copy of ' || coalesce(nullif(t.label, ''), c.target_table)
from featherbase.copy_refresh_schedule c left join featherbase.table_def t on t.name = c.target_table
where c.scheduled_job = j.method and coalesce(j.title, '') = '';

-- Any other job (an app's, or one added since): its name in words, Title Case,
-- without the app's prefix ("tasker.escalate_issues" -> "Escalate Issues").
update featherbase.scheduled_job set title = initcap(replace(regexp_replace(method, '^[a-z0-9_]+\.', ''), '_', ' '))
where coalesce(title, '') = '';
