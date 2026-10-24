-- #380 stage 3 (Shop Floor design system): there is one colour palette, so the
-- per-person palette choice goes, column and all. The theme gains `device`
-- (follow the phone or computer's own light/dark setting) and it becomes the
-- default. `light` was the old default and was stored for anyone who never
-- chose, so it cannot be told apart from a choice; those people follow the
-- device from now on. `dark` was always someone's choice and stays.
delete from featherbase.metadata_override
  where table_name = 'Person'
    and (column_name = 'palette' or (column_name = 'theme' and property in ('choices', 'default_value')));
delete from featherbase.column_def where parent = 'Person' and column_name = 'palette';
alter table featherbase.person drop column if exists palette;

update featherbase.column_def
  set choices = E'light\ndark\ndevice', default_value = 'device'
  where parent = 'Person' and column_name = 'theme';
update featherbase.person set theme = 'device' where theme is null or theme = 'light';
