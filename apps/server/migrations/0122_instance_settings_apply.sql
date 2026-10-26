-- Instance settings as code (#465, D4 and D5): the last successful apply of
-- the instance's settings file. Its managed paths are the fields Admin may no
-- longer change (managed-settings.ts); one row, replaced by each apply.
create table instance_settings_apply (
  id boolean primary key default true check (id),
  applied_at timestamptz not null default now(),
  applied_by text not null,
  environment text,
  revision text,
  run text,
  managed_paths jsonb not null default '[]'::jsonb
);
revoke all on instance_settings_apply from public;
