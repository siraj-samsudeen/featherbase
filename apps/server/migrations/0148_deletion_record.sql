-- #859 (design decision 11): a permanent delete leaves one Access Log entry per
-- removed row, with why and what the row held. The Access Log is
-- system-written and read only by System Managers.
alter table featherbase.access_log add column if not exists reason text;
alter table featherbase.access_log add column if not exists snapshot jsonb;
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only)
select 'Access Log', 7, 'reason', 'Reason', 'Text', true
where not exists (select 1 from featherbase.column_def where parent = 'Access Log' and column_name = 'reason');
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only)
select 'Access Log', 8, 'snapshot', 'Row as it was', 'JSON', true
where not exists (select 1 from featherbase.column_def where parent = 'Access Log' and column_name = 'snapshot');
