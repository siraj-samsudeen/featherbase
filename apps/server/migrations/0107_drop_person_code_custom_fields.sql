-- #408 (person-resolution task 2.1): sales-target scoping reads the person's
-- current `stylehr-employee-code` identifier rows, so the two roster-copy
-- Custom Fields on Person go: an editable copy let a hand edit move a
-- person's report scope past the one-holder rule, with no history. 0102
-- already carried every `employee_code` value into identifier rows. A no-op
-- where the fields never existed (prod).
delete from featherbase.custom_field
  where dt = 'Person' and column_name in ('employee_code', 'stylehr_username');
delete from featherbase.column_def
  where parent = 'Person' and column_name in ('employee_code', 'stylehr_username') and custom;
alter table featherbase.person drop column if exists employee_code, drop column if exists stylehr_username;
