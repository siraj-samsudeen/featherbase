-- No existing copy is scheduled automatically.
alter table featherbase.table_copy
  add constraint table_copy_target_fkey foreign key (target_table)
  references featherbase.table_def(name) on update cascade on delete cascade not valid;
alter table featherbase.table_copy drop constraint table_copy_data_source_fkey;
alter table featherbase.table_copy add constraint table_copy_data_source_fkey
  foreign key (data_source) references featherbase.data_source(row_id)
  on update cascade on delete cascade;

create table featherbase.copy_refresh_schedule (
  target_table varchar(140) primary key references featherbase.table_copy(target_table) on update cascade on delete cascade,
  scheduled_job varchar(140) not null unique references featherbase.scheduled_job(row_id) on update cascade on delete cascade
);

create function featherbase.withdraw_copy_refresh() returns trigger language plpgsql as $$
begin
  delete from featherbase.background_job where method = old.scheduled_job and job_status = 'queued';
  delete from featherbase.scheduled_job where row_id = old.scheduled_job;
  return old;
end;
$$;
create trigger withdraw_copy_refresh after delete on featherbase.copy_refresh_schedule
  for each row execute function featherbase.withdraw_copy_refresh();
