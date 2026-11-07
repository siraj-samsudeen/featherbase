-- #731: the sales-target report left the platform; Dash serves the report.
-- Its cache goes: the snapshots of its dataset and the two Tables that held them.
delete from featherbase.dataset_snapshot where dataset = 'sales_target_mtd';
delete from featherbase.dataset_miss where dataset = 'sales_target_mtd';
drop table if exists featherbase.sales_target_snapshot_row;
drop table if exists featherbase.sales_target_snapshot_name;
