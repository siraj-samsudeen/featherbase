-- #1459: every Table declares who reads which of its rows (row_rule, one of a closed set of kinds; shared/row-rule.ts).
-- A Table with no rule is read by System Managers only. An app's Table takes its rule from the app's manifest; a
-- value here is then the instance's own rule for it, which wins.
alter table featherbase.table_def add column if not exists row_rule jsonb;

-- The Tables that exist when this runs keep what they do today, now said out loud: every row, to whoever a grant
-- reaches. That is the platform's own Tables (none is granted to anyone by default) and the instance's Tables made
-- before the rule existed, which the Tables page and instance health list for a System Manager's review. A Sub-table
-- follows its parent and a view its base, so neither has a rule; an app's Tables are declared by the app.
update featherbase.table_def set row_rule = '{"kind": "all"}'::jsonb
  where row_rule is null and owner_app is null and kind in ('table', 'settings');
