-- #1224: a service account reads as a name people understand ("Claude — setup
-- agent") wherever it is shown as having done something. The label stays a
-- slug other code finds the account by; this is only what readers see. Empty
-- means "Automation (<label>)".
alter table featherbase.service_account add column if not exists display_name text;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Service Account', (select coalesce(max(position), 0) + 1 from featherbase.column_def where parent = 'Service Account'), 'display_name', 'Display name', 'Data', null, false, false, true, false, true, 'basic', 'Table', 'columns', false,
  'What people see where this account did something, such as "Claude — setup agent". Empty reads as "Automation (<name>)".'
where not exists (select 1 from featherbase.column_def d where d.parent = 'Service Account' and d.column_name = 'display_name');
