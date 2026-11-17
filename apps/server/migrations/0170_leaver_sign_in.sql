-- #1271: Leavers Who Can Still Sign In. A report, rebuilt by the server: the
-- leaver job's own plan (disable_leavers, leaver-check.ts), people the people
-- app says have left who have no StyleHR link, and outsiders who hold an
-- employees-only link, each while they can still sign in some way. It changes
-- nobody: disabling stays the leaver job's alone. System Managers only (no grants).
create table if not exists featherbase.leaver_sign_in (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  person character varying(140) not null unique,
  why text not null,
  ways_in text not null,
  left_on date,
  source text not null check (source in ('leaver job', 'people app', 'not an employee'))
);
alter table featherbase.leaver_sign_in enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'leaver_sign_in' and policyname = 'fc_select') then
    create policy fc_select on featherbase.leaver_sign_in for select using (featherbase.fc_has_read('Leaver Sign In'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope")
values ('Leaver Sign In', 'Core', 'table', false, 'hash', 'person', 'left_on', 'desc', false,
        'Someone who has left, or is not an employee, but can still sign in. Rebuilt by the server; it changes nobody.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'Leavers Who Can Still Sign In', true, false)
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Leaver Sign In', c.position, c.column_name, c.label, c.column_type, c.reference_table, c.reqd, false, true, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'person', 'Person', 'Reference', 'Person', true, true, null),
  (2, 'why', 'Why', 'Data', null, true, true, 'Why they are listed: when they left, or that they are not an employee and hold an employees-only link.'),
  (3, 'ways_in', 'Ways In', 'Data', null, true, true, 'How they can still sign in.'),
  (4, 'left_on', 'Leaving Date', 'Date', null, false, true, null),
  (5, 'source', 'Found By', 'Data', null, true, false, 'The leaver job, the people app, or an employees-only link held by someone who is not an employee.')
) as c(position, column_name, label, column_type, reference_table, reqd, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Leaver Sign In' and d.column_name = c.column_name);

insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "submission_status", "position", "method", "cadence", "enabled", "description", "problem_alert_queued")
values ('refresh_leaver_sign_in', 'Administrator', 'Administrator', 'draft', 0, 'refresh_leaver_sign_in', 'daily', true,
        'Rebuild Leavers Who Can Still Sign In. It also runs after each leaver check and roster sync. It changes nobody.', false)
on conflict ("row_id") do nothing;
