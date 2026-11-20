-- #1366: the old Sales Target page is retired (Dash, an installed app, replaced it). Its dataset,
-- sales_target_mtd, was cached in these two tables, which nothing reads any more. The rows were a
-- rebuildable copy of the warehouse, so nothing is lost. The dataset's registry rows and asks go
-- with them. The `Sales Target Assignment` Table and the `Sales Target Viewer` role are instance
-- data, not platform tables, and are left as they are.
drop table if exists featherbase.sales_target_snapshot_row;
drop table if exists featherbase.sales_target_snapshot_name;
delete from featherbase.dataset_snapshot where dataset = 'sales_target_mtd';
delete from featherbase.dataset_miss where dataset = 'sales_target_mtd';
