-- #1271: Leavers Who Can Still Sign In. A report, rebuilt by the server, of
-- people who can still sign in some way, in four sections:
--   1. whom the leaver job (disable_leavers, leaver-check.ts) would disable, and the rule that hit them;
--   2. System Managers who match a leaver rule, whom the job never disables;
--   3. people the people app says have left who hold no StyleHR link;
--   4. people the people app says are not employees who hold a StyleHR link.
-- It changes nobody: disabling stays the leaver job's alone. System Managers only (no grants).
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
  section text not null check (section in ('1. Leaver job would disable', '2. System Manager: never disabled by the job',
    '3. Left, no StyleHR link', '4. Not an employee, holds a StyleHR link'))
);
alter table featherbase.leaver_sign_in enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'leaver_sign_in' and policyname = 'fc_select') then
    create policy fc_select on featherbase.leaver_sign_in for select using (featherbase.fc_has_read('Leaver Sign In'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope")
values ('Leaver Sign In', 'Core', 'table', false, 'hash', 'person', 'position', 'asc', false,
        'Someone who has left, or is not an employee, but can still sign in, in four sections. Rebuilt by the server; it changes nobody.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'Leavers Who Can Still Sign In', true, false)
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Leaver Sign In', c.position, c.column_name, c.label, c.column_type, c.reference_table, c.choices, c.reqd, false, true, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'section', 'Section', 'Choice', null,
     E'1. Leaver job would disable\n2. System Manager: never disabled by the job\n3. Left, no StyleHR link\n4. Not an employee, holds a StyleHR link',
     true, true, 'Which part of the report: the leaver job''s own plan (1, 2), or what the people app says (3, 4).'),
  (2, 'person', 'Person', 'Reference', 'Person', null, true, true, null),
  (3, 'why', 'Why', 'Data', null, null, true, true, 'The rule that listed them: the leaver job''s own wording, or what the people app says.'),
  (4, 'left_on', 'Leaving Date', 'Date', null, null, false, true, null),
  (5, 'ways_in', 'Ways In', 'Data', null, null, true, true, 'How they can still sign in.')
) as c(position, column_name, label, column_type, reference_table, choices, reqd, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Leaver Sign In' and d.column_name = c.column_name);

insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "submission_status", "position", "method", "cadence", "enabled", "description", "problem_alert_queued")
values ('refresh_leaver_sign_in', 'Administrator', 'Administrator', 'draft', 0, 'refresh_leaver_sign_in', 'daily', true,
        'Rebuild Leavers Who Can Still Sign In. It also runs after each leaver check and roster sync. It changes nobody.', false)
on conflict ("row_id") do nothing;
