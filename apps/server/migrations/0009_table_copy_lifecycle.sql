-- #772 owns copy provenance independently of #840's schedule linkage.
-- Remove only provenance whose native Table was already deleted. Import Log,
-- Version and surviving native rows are historical data and remain untouched.
delete from featherbase.table_copy c
where not exists (select 1 from featherbase.table_def t where t.name = c.target_table);

-- Replace the named constraints so databases that already ran the provisional
-- #840 0008 (including its NOT VALID target constraint) converge as well.
alter table featherbase.table_copy drop constraint if exists table_copy_target_fkey;
alter table featherbase.table_copy add constraint table_copy_target_fkey
  foreign key (target_table) references featherbase.table_def(name)
  on update cascade on delete cascade;

-- Removing a source withdraws provenance, never the ordinary native copy.
-- #840's dependent schedule linkage then cascades through its own lifecycle.
alter table featherbase.table_copy drop constraint table_copy_data_source_fkey;
alter table featherbase.table_copy add constraint table_copy_data_source_fkey
  foreign key (data_source) references featherbase.data_source(row_id)
  on update cascade on delete cascade;
