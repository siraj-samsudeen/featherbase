-- #975: the first slice of #627's Change Proposal. System-written: only the platform writes these,
-- so no grant or Administrator can apply or rewrite a proposal from the side.

create table if not exists featherbase.change_proposal (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  status text default 'draft' not null,
  "position" integer default 0 not null,
  app varchar(140),
  target_table varchar(140),
  target_row varchar(140),
  maker varchar(140),
  proposal_state varchar(140),
  about jsonb,
  decided_by varchar(140),
  decided_at timestamp with time zone,
  decision_reason text,
  result_row varchar(140)
);
create table if not exists featherbase.change_proposal_column (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  status text default 'draft' not null,
  "position" integer default 0 not null,
  parent varchar(140),
  parenttype varchar(140),
  parentfield varchar(140),
  column_name varchar(140),
  original_value text,
  proposed_value text,
  review_base_value text
);
create table if not exists featherbase.change_proposal_approver (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  status text default 'draft' not null,
  "position" integer default 0 not null,
  parent varchar(140),
  parenttype varchar(140),
  parentfield varchar(140),
  person varchar(140),
  role varchar(140)
);
create index if not exists change_proposal_app_state on featherbase.change_proposal (app, proposal_state);
create index if not exists change_proposal_target on featherbase.change_proposal (target_table, target_row);
create index if not exists change_proposal_maker on featherbase.change_proposal (maker);
create index if not exists change_proposal_column_parent on featherbase.change_proposal_column (parent);
create index if not exists change_proposal_approver_parent on featherbase.change_proposal_approver (parent);

insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Change Proposal', 'Core', 'table', false, 'hash', 'updated_at', 'desc', false, 'A change to a row that waits for approval (#627). Written only by the platform.', false, true, true, false) on conflict (name) do nothing;
insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Change Proposal Column', 'Core', 'sub_table', false, 'hash', 'updated_at', 'desc', false, 'One changed column of a Change Proposal.', false, true, true, false) on conflict (name) do nothing;
insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Change Proposal Approver', 'Core', 'sub_table', false, 'hash', 'updated_at', 'desc', false, 'A person or role who can approve a Change Proposal.', false, true, true, false) on conflict (name) do nothing;

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 1, 'app', 'App', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'The app that made the proposal.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'app');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 2, 'target_table', 'Table', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'target_table');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 3, 'target_row', 'Row', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, 'Empty for a proposed new row.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'target_row');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 4, 'maker', 'Made by', 'Reference', 'Person', NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'maker');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 5, 'proposal_state', 'State', 'Choice', NULL, 'Pending
Applied
Rejected
Needs fresh review', NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'proposal_state');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 6, 'about', 'About', 'JSON', NULL, NULL, NULL, false, false, true, false, false, 'basic', 'Table', 'columns', false, 'The app''s own description of the proposal.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'about');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 7, 'decided_by', 'Decided by', 'Reference', 'Person', NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'decided_by');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 8, 'decided_at', 'Decided at', 'Datetime', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'decided_at');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 9, 'decision_reason', 'Reason', 'Long Text', NULL, NULL, NULL, false, false, true, false, false, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'decision_reason');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 10, 'result_row', 'New row', 'Data', NULL, NULL, NULL, false, false, true, false, false, 'basic', 'Table', 'columns', false, 'The row added when the proposal was applied.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'result_row');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 11, 'changes', 'Changes', 'Sub-table', NULL, NULL, 'Change Proposal Column', false, false, true, false, false, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'changes');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal', 12, 'approvers', 'Approvers', 'Sub-table', NULL, NULL, 'Change Proposal Approver', false, false, true, false, false, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal' and column_name = 'approvers');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Column', 1, 'column_name', 'Column', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Column' and column_name = 'column_name');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Column', 2, 'original_value', 'Original', 'Long Text', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Column' and column_name = 'original_value');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Column', 3, 'proposed_value', 'Proposed', 'Long Text', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Column' and column_name = 'proposed_value');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Column', 4, 'review_base_value', 'Reviewed', 'Long Text', NULL, NULL, NULL, false, false, true, false, false, 'basic', 'Table', 'columns', false, 'What the approver reviewed against; a different value at approval means a fresh review.'
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Column' and column_name = 'review_base_value');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Approver', 1, 'person', 'Person', 'Reference', 'Person', NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Approver' and column_name = 'person');
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Change Proposal Approver', 2, 'role', 'Role', 'Data', NULL, NULL, NULL, false, false, true, false, true, 'basic', 'Table', 'columns', false, NULL
where not exists (select 1 from featherbase.column_def where parent = 'Change Proposal Approver' and column_name = 'role');
