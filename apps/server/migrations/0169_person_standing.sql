-- #1267 step 3: who a person is to the organisation. Their standing (Employee,
-- Former Employee, External) is not stored: an app that knows the people says
-- it (its `people.describe` read). Two marks are stored here.

-- A label an administrator may put on an External person. It describes them
-- only; it is read only while the person is External, and it never grants
-- anything (#1218's Vendor business role is what gives a vendor access).
alter table featherbase.person add column if not exists external_label text;
alter table featherbase.person drop constraint if exists person_external_label_known;
alter table featherbase.person add constraint person_external_label_known
  check (external_label is null or external_label in ('Consultant', 'Vendor'));

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, choices, reqd, "unique",
  read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Person', 17, 'external_label', 'External label', 'Choice', E'Consultant\nVendor', false, false,
  false, false, false, 'basic', 'Table', 'columns', false,
  'For someone outside the organisation: what they are to it. A label only, shown while they are External; it never grants access.'
where not exists (select 1 from featherbase.column_def where parent = 'Person' and column_name = 'external_label');

-- A sign-in method only employees may use (option A): linking it to a Former
-- Employee or an External person is refused, and their page offers no line for it.
alter table featherbase.sign_in_method add column if not exists employees_only boolean not null default false;

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reqd, "unique", default_value,
  read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Sign In Method', 11, 'employees_only', 'Only for employees', 'Check', false, false, '0',
  false, false, false, 'basic', 'Table', 'columns', false,
  'Only for current employees: it is not offered or linked for a former employee or someone external.'
where not exists (select 1 from featherbase.column_def where parent = 'Sign In Method' and column_name = 'employees_only');
