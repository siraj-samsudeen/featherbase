-- Migrations are the one way to change a platform database (#692): the patch
-- runner is gone. An instance installed before the baseline still has its
-- record; a fresh one never creates it.
drop table if exists featherbase.patch_log;
