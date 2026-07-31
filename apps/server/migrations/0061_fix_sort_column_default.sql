-- 0055_terminology_rename renamed sort_field -> sort_column and rewrote the
-- existing rows, but left the column DEFAULT at the pre-rename 'modified'.
-- Every Table created since then (i.e. every Table built or imported through
-- the Admin) therefore got sort_column = 'modified', a column that no longer
-- exists — so getList() rejected its own default order_by and the Table's list
-- view rendered empty. Fix the default and repair the rows it already produced.
alter table table_def alter column sort_column set default 'updated_at';
update table_def set sort_column = 'updated_at' where sort_column = 'modified';
