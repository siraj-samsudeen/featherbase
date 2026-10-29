-- Migrations are the one way to change a platform database (#692): the patch
-- runner is gone. An instance installed before the baseline still has its
-- record; a fresh one never creates it. The one patch's index is made here
-- too, for an instance that ran the migrations but never the patch runner.
create index if not exists file_ref_idx on featherbase.file (ref_table, ref_name);
drop table if exists featherbase.patch_log;
