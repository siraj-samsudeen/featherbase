-- #955: waiting for access is per app. A person who opens an app, Feather Dash
-- or Featherbase itself without access asks for it; the Waiting for access
-- page lists these requests, and a request goes once the person can open it.
create table if not exists featherbase.access_request (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  status text default 'draft' not null,
  "position" integer default 0 not null,
  person character varying(140) not null,
  email character varying(140),
  app character varying(140) not null,
  app_name character varying(140) not null,
  reminded_at timestamp with time zone,
  unique (person, app_name)
);
alter table featherbase.access_request enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'access_request' and policyname = 'fc_select') then
    create policy fc_select on featherbase.access_request for select using (featherbase.fc_has_read('Access Request'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "status", "position", "label", "system_written", "decides_scope")
values ('Access Request', 'Core', 'table', false, 'hash', 'person', 'created_at', 'desc', false,
        'Someone who opened an app without access to it. The request goes once they can open that app.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, null, true, false)
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Access Request', c.position, c.column_name, c.label, c.column_type, c.reference_table, c.reqd, false, true, c.hidden, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'person', 'Person', 'Reference', 'Person', true, false, true, null),
  (2, 'email', 'Email', 'Data', null, false, false, true, null),
  (3, 'app', 'App', 'Data', null, true, false, true, 'The app they opened, as its name reads.'),
  (4, 'app_name', 'App id', 'Data', null, true, true, false, null),
  (5, 'reminded_at', 'Reminder sent', 'Datetime', null, false, false, false, 'When System Managers were reminded that this request is still waiting.')
) as c(position, column_name, label, column_type, reference_table, reqd, hidden, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Access Request' and d.column_name = c.column_name);

insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "status", "position", "method", "cadence", "enabled", "description", "problem_alert_queued")
values ('remind_access_requests', 'Administrator', 'Administrator', 'draft', 0, 'remind_access_requests', 'hourly', true,
        'Remind System Managers, once, about access requests still waiting a day after they were made.', false)
on conflict ("row_id") do nothing;
