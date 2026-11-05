-- #923: roles every signed-in person holds, set once for the instance.
insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'System Settings', 13, 'everyone_roles', 'Roles for everyone who signs in', 'Long Text', null, false, false, false, false, false, 'basic', 'Table', 'columns', false,
       'One role per line. Everyone who signs in holds these roles without adding them to each Person. Removing one here takes it from people who held it only through this setting.'
where not exists (select 1 from featherbase.column_def where parent = 'System Settings' and column_name = 'everyone_roles');
