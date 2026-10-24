-- #432: audit and machinery tables are written by the server alone. With the
-- flag set, the generic row API, import, rename and every column change refuse
-- the Table for every principal, Administrator and System Manager included;
-- the server's own writers (sign-in logging, the job runner, the email queue,
-- the import logger, the version trail) keep writing. Only migrations set it:
-- the /api/table_def schema has no such key.
alter table featherbase.table_def add column if not exists system_written boolean not null default false;

-- The Table Table describes itself, so the flag is a selectable field.
insert into featherbase.column_def (parent, position, column_name, label, column_type, read_only)
select 'Table', 9, 'system_written', 'Written by the platform only', 'Check', true
where not exists (
  select 1 from featherbase.column_def where parent = 'Table' and column_name = 'system_written'
);

-- One decision per table; the PR for #432 records why each is in or out.
update featherbase.table_def set system_written = true
where system and name in (
  'Access Log',
  'Activity Log',
  'Background Job',
  'Dataset Miss',
  'Dataset Snapshot',
  'Email Queue',
  'Email Sink',
  'Import Log',
  'Job Execution',
  'Notification Log',
  'User Event',
  'Version'
);
