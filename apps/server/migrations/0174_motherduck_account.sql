-- #1346: MotherDuck Accounts. One row per user of the MotherDuck data warehouse,
-- kept in step by a daily sync (motherduck-accounts.ts) from MotherDuck's own
-- list of users, as the roster sync keeps Employees in step with HR. A row is
-- never deleted: a user MotherDuck no longer lists is marked Removed, with the
-- date. The sync links an account to its Person when exactly one person has its
-- email; any other account gets a ticket for a person to link it by hand.
create table if not exists featherbase.motherduck_account (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  username text not null,
  person character varying(140) references featherbase.person (row_id),
  account_status text not null default 'Active' check (account_status in ('Active', 'Deprovisioned', 'Removed')),
  email text,
  full_name text,
  roles text,
  service_account boolean not null default false,
  first_listed_on date,
  last_listed_on date,
  removed_on date,
  review_ticket text
);
alter table featherbase.motherduck_account enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'motherduck_account' and policyname = 'fc_select') then
    create policy fc_select on featherbase.motherduck_account for select using (featherbase.fc_has_read('MotherDuck Account'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope", "search_columns")
values ('MotherDuck Account', 'Core', 'table', false, 'prompt', 'username', 'username', 'asc', true,
        'A user of the MotherDuck data warehouse, kept in step daily from MotherDuck''s own list. Link it to the person who uses it.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'MotherDuck Accounts', false, false, array['email'])
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'MotherDuck Account', c.position, c.column_name, c.label, c.column_type, c.reference_table, c.choices, c.reqd, false, c.read_only, c.hidden, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'username', 'Username', 'Data', null, null, true, true, false, true, 'Their username in MotherDuck, as its query history names them.'),
  (2, 'person', 'Person', 'Reference', 'Person', null, false, false, false, true, 'Who uses this account. Set by the sync when exactly one person has its email; otherwise by hand.'),
  (3, 'account_status', 'Status', 'Choice', null, E'Active\nDeprovisioned\nRemoved', true, true, false, true,
     'Active: MotherDuck lists it and it can be used. Deprovisioned: MotherDuck still lists it but has switched it off. Removed: MotherDuck no longer lists it.'),
  (4, 'email', 'Email', 'Data', null, null, false, true, false, true, null),
  (5, 'full_name', 'Name in MotherDuck', 'Data', null, null, false, true, false, false, null),
  (6, 'roles', 'Roles in MotherDuck', 'Data', null, null, false, true, false, false, null),
  (7, 'service_account', 'Service account', 'Check', null, null, false, true, false, true, 'An account a program uses, not a person.'),
  (8, 'first_listed_on', 'First listed', 'Date', null, null, false, true, false, false, 'The first day the sync found it in MotherDuck''s list.'),
  (9, 'last_listed_on', 'Last listed', 'Date', null, null, false, true, false, false, 'The last day the sync found it in MotherDuck''s list.'),
  (10, 'removed_on', 'Removed on', 'Date', null, null, false, true, false, false, 'The day the sync found it gone from MotherDuck''s list.'),
  (11, 'review_ticket', 'Review ticket', 'Data', null, null, false, true, true, false, 'The ticket asking for this account to be linked to a person.')
) as c(position, column_name, label, column_type, reference_table, choices, reqd, read_only, hidden, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'MotherDuck Account' and d.column_name = c.column_name);

-- Who is asked to link an account the sync cannot link itself.
insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'System Settings', 14, 'motherduck_reviewer', 'MotherDuck reviewer', 'Reference', 'Person', false, false, false, false, false, 'basic', 'Table', 'columns', false,
  'Who is given a ticket to link a MotherDuck account the sync cannot link itself.'
where not exists (select 1 from featherbase.column_def where parent = 'System Settings' and column_name = 'motherduck_reviewer');

insert into featherbase.scheduled_job ("row_id", "created_by", "updated_by", "submission_status", "position", "method", "cadence", "enabled", "description", "problem_alert_queued")
values ('sync_motherduck_accounts', 'Administrator', 'Administrator', 'draft', 0, 'sync_motherduck_accounts', 'daily', true,
        'Bring MotherDuck Accounts in step with MotherDuck''s list of users, link the ones whose email names one person, and raise a ticket for the rest. It only reads MotherDuck.', false)
on conflict ("row_id") do nothing;
