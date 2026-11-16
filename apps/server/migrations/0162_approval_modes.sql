-- #1191: how each kind of approval works. An app declares its approval types; one Approval Type
-- row, named <app>.<type>, sets each one's mode. No row means Approve first. A proposal records the
-- mode it was made under, and an applied one waits as Not yet reviewed for Confirmed or Undone.
create table if not exists featherbase.approval_type (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  app varchar(140),
  approval_type varchar(140),
  title varchar(140),
  grants_access boolean default false not null,
  mode varchar(140) default 'Approve first',
  retired_at timestamptz,
  retired_by varchar(140),
  retired_reason text
);
alter table featherbase.approval_type enable row level security;
drop policy if exists fc_select on featherbase.approval_type;
create policy fc_select on featherbase.approval_type for select using (featherbase.fc_has_read('Approval Type'::text));

insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, title_column, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Approval Type', 'Core', 'table', false, 'prompt', 'title', 'row_id', 'asc', true,
  'How each kind of approval an app declares works: approve first, or apply now and review after (#1191). Named <app>.<type>.', false, true, false, false)
on conflict (name) do nothing;
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Approval Type', 1, 'app', 'App', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'The app that declares this kind of approval.'
where not exists (select 1 from featherbase.column_def where parent = 'Approval Type' and column_name = 'app');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Approval Type', 2, 'approval_type', 'Approval type', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'The name the app gives it.'
where not exists (select 1 from featherbase.column_def where parent = 'Approval Type' and column_name = 'approval_type');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Approval Type', 3, 'title', 'What is approved', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'As the app describes it.'
where not exists (select 1 from featherbase.column_def where parent = 'Approval Type' and column_name = 'title');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Approval Type', 4, 'grants_access', 'Grants access', 'Check', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'It gives someone a role or report access, so it is always approve first.'
where not exists (select 1 from featherbase.column_def where parent = 'Approval Type' and column_name = 'grants_access');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Approval Type', 5, 'mode', 'How it works', 'Choice', NULL, 'Approve first
Apply now, review after', NULL, false, false, false, false, true, 'basic', 'Table', 'columns', false, 'Approve first: nothing changes until an approver approves. Apply now, review after: it changes at once, and an approver confirms it or undoes it.'
where not exists (select 1 from featherbase.column_def where parent = 'Approval Type' and column_name = 'mode');

alter table featherbase.change_proposal add column if not exists approval_type varchar(140);
alter table featherbase.change_proposal add column if not exists approval_mode varchar(140) default 'Approve first' not null;
-- What an applied change left behind, so an undo can tell whether anyone has changed it since.
alter table featherbase.change_proposal add column if not exists applied_rows jsonb;

update featherbase.column_def set choices = 'Pending
Applied
Rejected
Needs fresh review
Withdrawn
Not yet reviewed
Confirmed
Undone'
where parent = 'Change Proposal' and column_name = 'proposal_state' and choices not like '%Not yet reviewed%';
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 14, 'approval_type', 'Approval type', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'The kind of approval, as the app declares it.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'approval_type');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 15, 'approval_mode', 'How it works', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'The mode it was made under: Approve first, or Apply now, review after.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'approval_mode');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 16, 'applied_rows', 'Applied rows', 'JSON', NULL, NULL, NULL, false, false, true, false, false, 'basic', 'Table', 'columns', false, 'What applying it left, so an undo can tell whether anything has changed since.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'applied_rows');
