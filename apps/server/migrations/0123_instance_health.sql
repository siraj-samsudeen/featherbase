-- Instance health (#465, design D8). Three parts:
--
-- 1. The values the last apply left, beside the paths it locked, so the
--    "settings match the file" check can tell when a break-glass change has
--    made the database differ. Null on an apply recorded before this column:
--    the check then asks for one more apply.
alter table instance_settings_apply add column if not exists managed_values jsonb;

-- 2. Each check's changes of state, and nothing else: a check that stays the
--    same writes no row, so the timeline costs almost nothing to keep.
create table if not exists health_check_event (
  id bigserial primary key,
  check_key text not null,
  ok boolean not null,
  severity text not null check (severity in ('error', 'warning')),
  message text not null,
  at timestamptz not null default now()
);
create index if not exists health_check_event_key_at on health_check_event (check_key, at desc, id desc);
revoke all on health_check_event from public;

-- 3. The checks run on their own every 15 minutes, so the history is right
--    even when nobody opens the page. On by default: it only reads, and
--    records what changed.
insert into scheduled_job (row_id, created_by, updated_by, created_at, updated_at, status, position, method, cadence, enabled, description)
select 'check_instance_health', 'Administrator', 'Administrator', now(), now(), 'draft', 0, 'check_instance_health', 'every 15 minutes', true,
  'Run the instance health checks and record every check that started failing or passed again, so the history on the Instance health page is right even when nobody opens it.'
where not exists (select 1 from scheduled_job where method = 'check_instance_health');
