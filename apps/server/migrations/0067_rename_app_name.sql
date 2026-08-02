-- The product's working name was `frappe-clone`, and the seeded brand string
-- "Frappe Clone" outlived the July 2026 rename to Featherbase: it was the
-- System Settings `app_name` default in 0024_singles.ts, and 0024 returns
-- early when 'System Settings' already exists, so editing that seed only fixes
-- databases created from scratch. Repair the ones already built.
--
-- Only the untouched original is rewritten — an owner who deliberately set
-- their own app_name keeps it.
update column_def
  set default_value = 'Featherbase'
  where parent = 'System Settings'
    and column_name = 'app_name'
    and default_value = 'Frappe Clone';

update single_value
  set value = 'Featherbase'
  where table_name = 'System Settings'
    and field = 'app_name'
    and value = 'Frappe Clone';
