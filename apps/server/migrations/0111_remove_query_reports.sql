-- #451: Query Reports are removed. A Report is now either a Report Builder
-- report or a Script Report, so the Query Report choice and the `query` text
-- it carried go. A Query Report row would be left pointing at a kind that no
-- longer runs, so its presence stops the migration for an operator to decide;
-- no deployment had one when this shipped.
do $$
begin
  if exists (select 1 from featherbase.report where report_type = 'Query Report') then
    raise exception 'Query Reports are no longer supported, but this database still has %. Delete them (or change their report type) and re-run.',
      (select string_agg(row_id, ', ' order by row_id) from featherbase.report where report_type = 'Query Report');
  end if;
end $$;

update featherbase.column_def set choices = E'Report Builder\nScript Report'
  where parent = 'Report' and column_name = 'report_type';
delete from featherbase.column_def where parent = 'Report' and column_name = 'query';
alter table featherbase.report drop column if exists query;
