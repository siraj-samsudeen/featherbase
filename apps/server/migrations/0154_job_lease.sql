-- #978: a running job holds a lease that its worker keeps renewing. A running
-- row whose lease has run out was left by a server that stopped mid-run, and
-- any worker recovers it.
alter table featherbase.background_job add column if not exists lease_expires_at timestamp with time zone;
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only)
select 'Background Job', 10, 'lease_expires_at', 'Worker check-in due by', 'Datetime', true
where not exists (select 1 from featherbase.column_def where parent = 'Background Job' and column_name = 'lease_expires_at');
