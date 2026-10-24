-- The daily warehouse exit-date check (data-warehouse #4336). Seeded OFF:
-- the job disables people, so a System Manager turns it on only after a dry
-- run (`cli leavers:check`) on this instance has been reviewed.
insert into scheduled_job (row_id, created_by, updated_by, created_at, updated_at, status, position, method, cadence, enabled, description)
select 'disable_leavers', 'Administrator', 'Administrator', now(), now(), 'draft', 0, 'disable_leavers', 'daily', false,
  'Disable everyone whose StyleHR record in the warehouse shows they have left: an exit date that has passed, an inactive status, or not on the latest payroll. Only ever disables; skips and reports System Managers; refuses on a stale feed or an implausibly large batch.'
where not exists (select 1 from scheduled_job where method = 'disable_leavers');
