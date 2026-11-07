-- #627: approval rules. A rule says which changes to a Table apply at once, which wait for
-- approvers, and (once a Table has a rule) that any other change is refused. Rules are data a
-- System Manager edits, with history; Approval Rule is a security Table (security-tables.ts).
create table if not exists featherbase.approval_rule (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  ref_table varchar(140),
  enabled boolean default true,
  operations varchar(140),
  governed_columns text,
  row_condition jsonb,
  maker_role varchar(140),
  maker_resolver varchar(140),
  outcome varchar(140),
  approvals_needed varchar(140),
  description text
);
create table if not exists featherbase.approval_rule_approver (
  row_id varchar(140) primary key,
  created_by varchar(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by varchar(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  parent varchar(140),
  parenttype varchar(140),
  parentfield varchar(140),
  role varchar(140),
  resolver varchar(140)
);
create index if not exists approval_rule_table on featherbase.approval_rule (ref_table);
create index if not exists approval_rule_approver_parent on featherbase.approval_rule_approver (parent, "position");
alter table featherbase.approval_rule enable row level security;
alter table featherbase.approval_rule_approver enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'approval_rule' and policyname = 'fc_select') then
    create policy fc_select on featherbase.approval_rule for select using (featherbase.fc_has_read('Approval Rule'::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'approval_rule_approver' and policyname = 'fc_select') then
    create policy fc_select on featherbase.approval_rule_approver for select using (featherbase.fc_has_read((parenttype)::text));
  end if;
end $$;

insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, title_column, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Approval Rule', 'Core', 'table', false, 'hash', 'description', 'updated_at', 'desc', true,
  'Who may change which rows of a Table, and whether the change applies at once or waits for approvers (#627).', false, true, false, false)
on conflict (name) do nothing;
insert into featherbase.table_def (name, module, kind, is_submittable, id_pattern, sort_column, sort_order, track_changes, description, custom, system, system_written, decides_scope)
values ('Approval Rule Approver', 'Core', 'sub_table', false, 'hash', 'updated_at', 'desc', true, 'One approver of an Approval Rule: a role, or a person an app names for the row.', false, true, false, false)
on conflict (name) do nothing;

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", default_value, read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, c.parent, c.position, c.column_name, c.label, c.column_type, c.reference_table, c.choices, c.row_table, c.reqd, false, c.default_value, false, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  ('Approval Rule', 1, 'description', 'Description', 'Data', null, null, null, false, null, true, 'What the rule is for, in a few words.'),
  ('Approval Rule', 2, 'ref_table', 'Table', 'Data', null, null, null, true, null, true, 'The Table whose changes this rule governs.'),
  ('Approval Rule', 3, 'enabled', 'Enabled', 'Check', null, null, null, false, '1', true, null),
  ('Approval Rule', 4, 'operations', 'Covers', 'Choice', null, E'Changes and new rows\nChanges\nNew rows', null, true, 'Changes and new rows', false, null),
  ('Approval Rule', 5, 'governed_columns', 'Columns', 'Long Text', null, null, null, false, null, false, 'One column name per line. Empty means every column.'),
  ('Approval Rule', 6, 'row_condition', 'Rows', 'JSON', null, null, null, false, null, false, 'A list filter, such as [["site", "=", "A"]]. Empty means every row.'),
  ('Approval Rule', 7, 'maker_role', 'Maker holds role', 'Reference', 'Role', null, null, false, null, true, 'Only makers with this role. Empty means anyone the Table lets write.'),
  ('Approval Rule', 8, 'maker_resolver', 'Maker is', 'Data', null, null, null, false, null, false, 'Only the person an app names for the row, as app.resolver, such as shelves.site_lead.'),
  ('Approval Rule', 9, 'outcome', 'Outcome', 'Choice', null, E'Route to approvers\nApply and log', null, true, 'Route to approvers', true, null),
  ('Approval Rule', 10, 'approvals_needed', 'Approvals needed', 'Choice', null, E'All\nAny', null, false, 'All', false, 'With several approvers: every one of them, or any one.'),
  ('Approval Rule', 11, 'approvers', 'Approvers', 'Sub-table', null, null, 'Approval Rule Approver', false, null, false, null),
  ('Approval Rule Approver', 1, 'role', 'Role', 'Reference', 'Role', null, null, false, null, true, 'Anyone holding this role.'),
  ('Approval Rule Approver', 2, 'resolver', 'Person named by', 'Data', null, null, null, false, null, true, 'The person an app names for the row, as app.resolver.')
) as c(parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, default_value, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = c.parent and d.column_name = c.column_name);

-- A rule-made proposal has no app. It holds the values the maker sent, to save again at approval,
-- the rules that matched, and which of its approvers have approved.
alter table featherbase.change_proposal add column if not exists operation varchar(140);
alter table featherbase.change_proposal add column if not exists proposed_values jsonb;
alter table featherbase.change_proposal_approver add column if not exists requirement varchar(140);
alter table featherbase.change_proposal_approver add column if not exists approved_by varchar(140);
alter table featherbase.change_proposal_approver add column if not exists approved_at timestamp with time zone;
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, c.parent, c.position, c.column_name, c.label, c.column_type, null, null, null, false, false, true, false, false, 'basic', 'Table', 'columns', false, c.description
from (values
  ('Change Proposal', 13, 'operation', 'Operation', 'Data', 'A change, or a new row. Empty for an app''s proposal.'),
  ('Change Proposal', 14, 'proposed_values', 'Proposed values', 'JSON', 'What the maker saved, saved again as the maker when approved.'),
  ('Change Proposal Approver', 3, 'requirement', 'Requirement', 'Data', 'The rule and approver this stands for. One approval meets one requirement.'),
  ('Change Proposal Approver', 4, 'approved_by', 'Approved by', 'Data', null),
  ('Change Proposal Approver', 5, 'approved_at', 'Approved at', 'Datetime', null)
) as c(parent, position, column_name, label, column_type, description)
where not exists (select 1 from featherbase.column_def d where d.parent = c.parent and d.column_name = c.column_name);
