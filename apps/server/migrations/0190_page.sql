-- #1410 (ADR 0028): Pages. A page is a screen saved as data and drawn inside
-- Featherbase: its row holds what a list of pages needs (title, module, status)
-- and one JSON column, the definition, checked on every save by the Table's
-- controller (src/controllers/page.ts). The row's id is the page's address.
-- Only System Managers read or write the rows; everyone else reaches a page
-- through GET /api/pages/:name, which answers a Published page to anyone signed
-- in and a Draft only to someone who may build (design D4).
create table if not exists featherbase.page (
  row_id character varying(140) not null primary key,
  created_by character varying(140) default 'Administrator' not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by character varying(140) default 'Administrator' not null,
  submission_status text default 'draft' not null,
  "position" integer default 0 not null,
  retired_at timestamp with time zone,
  retired_by character varying(140),
  retired_reason text,
  title text not null,
  module text not null default 'Core',
  status text not null default 'Draft' check (status in ('Draft', 'Published')),
  description text,
  definition jsonb not null
);
alter table featherbase.page enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'page' and policyname = 'fc_select') then
    create policy fc_select on featherbase.page for select using (featherbase.fc_has_read('Page'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope", "search_columns")
values ('Page', 'Core', 'table', false, 'prompt', 'title', 'title', 'asc', true,
        'A screen saved as data and drawn inside Featherbase. Its definition names the parts it is made of; it is checked every time it is saved.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'Pages', false, false, array['title'])
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "choices", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description", "default_value")
select gen_random_uuid()::text, 'Page', c.position, c.column_name, c.label, c.column_type, null, c.choices, c.reqd, false, false, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description, c.default_value
from (values
  (1, 'title', 'Title', 'Data', null, true, true, 'The page''s heading in lists and menus.', null),
  (2, 'module', 'Module', 'Data', null, true, true, 'The group the page sits under, beside the Tables of the same module.', 'Core'),
  (3, 'status', 'Status', 'Choice', E'Draft\nPublished', true, true, 'Draft: only people who may build can open it. Published: anyone signed in can.', 'Draft'),
  (4, 'description', 'Description', 'Text', null, false, false, 'What the page is for.', null),
  (5, 'definition', 'Definition', 'JSON', null, true, false, 'The parts the page is made of, the state it keeps and the rows it reads.', null)
) as c(position, column_name, label, column_type, choices, reqd, in_list_view, description, default_value)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Page' and d.column_name = c.column_name);
