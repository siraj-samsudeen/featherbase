-- #1037: a glossary term may carry a picture, such as a diagram of how words
-- relate. It shows under the definition, so it takes the place after it in
-- the form and the columns after it move down one.
alter table featherbase.glossary_term add column if not exists picture text;

update featherbase.column_def set position = position + 1
where parent = 'Glossary Term' and position >= 4 and not custom
  and not exists (select 1 from featherbase.column_def where parent = 'Glossary Term' and column_name = 'picture');

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reference_table, choices, row_table, reqd, "unique", read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Glossary Term', 4, 'picture', 'Picture', 'Attach Image', NULL, NULL, NULL, false, false, false, false, false, 'basic', 'Table', 'columns', false, 'A diagram or photo that shows what the term means, or how it relates to other terms'
where not exists (select 1 from featherbase.column_def where parent = 'Glossary Term' and column_name = 'picture');
