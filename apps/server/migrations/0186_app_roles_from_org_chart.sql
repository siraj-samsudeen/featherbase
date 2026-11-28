-- #1453: app roles from the organisation's own records. An app declares which of its roles anyone the org chart gives
-- a place may hold (manifest `orgChartRoles`). A System Manager turns each one on with an Org Chart Role Rule row (a
-- security Table: no grant, no settings file, and no upgrade reaches it). The Scheduled Job below keeps App Roles
-- From The Org Chart in step: everyone the instance's scope provider gives at least one place holds each role turned
-- on, and loses it on the next run once they have none (a leaver, a job ended). Removing the rule takes the role from
-- everyone at once. The holder rows say who and why; System Managers only (no grants).
create table if not exists featherbase.org_chart_role_rule (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  app character varying(140) not null,
  app_role character varying(140) not null,
  unique (app, app_role)
);
alter table featherbase.org_chart_role_rule enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'org_chart_role_rule' and policyname = 'fc_select') then
    create policy fc_select on featherbase.org_chart_role_rule for select using (featherbase.fc_has_read('Org Chart Role Rule'::text));
  end if;
end $$;
-- The rebuild whose rows are on show: one that started before it writes nothing (as Leavers Who Can Still Sign In).
create table if not exists featherbase.app_role_from_org_chart_rebuild (
  id integer primary key default 1 check (id = 1),
  started_at timestamp with time zone not null,
  summary text not null
);
alter table featherbase.app_role_from_org_chart_rebuild enable row level security;
create table if not exists featherbase.app_role_from_org_chart (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  person character varying(140) not null,
  app character varying(140) not null,
  app_role character varying(140) not null,
  why text not null,
  unique (person, app, app_role)
);
alter table featherbase.app_role_from_org_chart enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'app_role_from_org_chart' and policyname = 'fc_select') then
    create policy fc_select on featherbase.app_role_from_org_chart for select using (featherbase.fc_has_read('App Role From Org Chart'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope")
values ('App Role From Org Chart', 'Core', 'table', false, 'hash', 'app_role', 'position', 'asc', false,
        'Who holds an app''s role because the org chart gives them a place, and which places. Kept in step by the server for each Org Chart Role Rule; nobody edits it.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'App Roles From The Org Chart', true, false)
on conflict ("name") do nothing;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope")
values ('Org Chart Role Rule', 'Core', 'table', false, 'hash', 'app_role', 'position', 'asc', true,
        'An app role everyone the org chart gives a place holds: the app declares it may be given so (orgChartRoles); a row here, added by a System Manager, turns it on. Removing the row takes it from everyone.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'Org Chart Role Rules', false, false)
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Org Chart Role Rule', c.position, c.column_name, c.label, 'Data', null, null, true, false, false, false, true, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'app', 'App', 'The app whose role it is.'),
  (2, 'app_role', 'Role', 'One of the roles the app declares under orgChartRoles, and created when it was installed.')
) as c(position, column_name, label, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Org Chart Role Rule' and d.column_name = c.column_name);

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'App Role From Org Chart', c.position, c.column_name, c.label, c.column_type, c.reference_table, null, true, false, true, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'person', 'Person', 'Reference', 'Person', true, null),
  (2, 'app', 'App', 'Data', null, true, 'The app whose role it is.'),
  (3, 'app_role', 'Role', 'Data', null, true, 'The app''s role, as the app declares it under orgChartRoles.'),
  (4, 'why', 'Why', 'Data', null, true, 'The places the org chart gives them, as the scope provider names them.')
) as c(position, column_name, label, column_type, reference_table, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'App Role From Org Chart' and d.column_name = c.column_name);

insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "submission_status", "position", "method", "title", "cadence", "enabled", "description", "problem_alert_queued")
values ('sync_org_chart_roles', 'Administrator', 'Administrator', 'draft', 0, 'sync_org_chart_roles', 'Sync App Roles From The Org Chart', 'daily', true,
        'Keeps App Roles From The Org Chart in step with the org chart for each Org Chart Role Rule: joiners get the role, leavers lose it. A run the scope provider cannot answer keeps the last holders.', false)
on conflict ("row_id") do nothing;
