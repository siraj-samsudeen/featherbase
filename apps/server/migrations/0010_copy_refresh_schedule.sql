-- No existing copy is scheduled automatically.
-- Preserve schedules created under the provisional 0008 filename in developer databases.
create table if not exists featherbase.copy_refresh_schedule (
  target_table varchar(140) primary key references featherbase.table_copy(target_table) on update cascade on delete cascade,
  scheduled_job varchar(140) not null unique references featherbase.scheduled_job(row_id) on update cascade on delete cascade
);

create or replace function featherbase.withdraw_copy_refresh() returns trigger language plpgsql as $$
begin
  delete from featherbase.background_job where method = old.scheduled_job and job_status = 'queued';
  delete from featherbase.scheduled_job where row_id = old.scheduled_job;
  return old;
end;
$$;
drop trigger if exists withdraw_copy_refresh on featherbase.copy_refresh_schedule;
create trigger withdraw_copy_refresh after delete on featherbase.copy_refresh_schedule
  for each row execute function featherbase.withdraw_copy_refresh();
