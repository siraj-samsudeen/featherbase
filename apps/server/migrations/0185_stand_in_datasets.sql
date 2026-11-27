-- #1409: stand-in datasets. An app's dataset is bound, per instance, to the
-- warehouse (the declared query, as before) or to a stand-in: rows with the
-- same columns, loaded from a CSV until the warehouse has them. The binding is
-- one row per `<app>.<dataset>`; no row means Warehouse. A stand-in is an
-- ordinary snapshot whose registry row says so, so a read can never serve
-- stand-in rows unmarked.
alter table featherbase.dataset_snapshot add column if not exists stand_in boolean not null default false;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Dataset Snapshot', 13, 'stand_in', 'Stand-in', 'Check', false, false, false, false, true, 'basic', 'Table', 'columns', false,
  'These rows were loaded from a file to stand in for the warehouse, not read from it.'
where not exists (select 1 from featherbase.column_def where parent = 'Dataset Snapshot' and column_name = 'stand_in');

create table if not exists featherbase.dataset_binding (
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
  app text not null,
  dataset text not null,
  served_from text not null default 'Warehouse' check (served_from in ('Warehouse', 'Stand-in')),
  note text,
  expected_by date,
  allowed_on_production boolean not null default false
);
alter table featherbase.dataset_binding enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'featherbase' and tablename = 'dataset_binding' and policyname = 'fc_select') then
    create policy fc_select on featherbase.dataset_binding for select using (featherbase.fc_has_read('Dataset Binding'::text));
  end if;
end $$;

insert into featherbase.table_def ("name", "module", "kind", "is_submittable", "id_pattern", "title_column", "sort_column", "sort_order", "track_changes", "description", "custom", "system", "created_by", "updated_by", "submission_status", "position", "label", "system_written", "decides_scope")
values ('Dataset Binding', 'Core', 'table', false, 'prompt', null, 'updated_at', 'desc', true,
        'Where one dataset of an installed app is served from in this instance: the warehouse, or a stand-in loaded from a file until the warehouse has the data. Named <app>.<dataset>.',
        false, true, 'Administrator', 'Administrator', 'draft', 0, 'Dataset Bindings', false, false)
on conflict ("name") do nothing;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "choices", "reqd", "unique", "default_value", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Dataset Binding', c.position, c.column_name, c.label, c.column_type, c.choices, c.reqd, false, c.default_value, c.read_only, false, true, 'basic', 'Table', 'columns', false, c.description
from (values
  (1, 'app', 'App', 'Data', null, false, null, true, 'The installed app that declares the dataset. Read from the row''s name.'),
  (2, 'dataset', 'Dataset', 'Data', null, false, null, true, 'The dataset, as the app names it. Read from the row''s name.'),
  (3, 'served_from', 'Served from', 'Choice', E'Warehouse\nStand-in', true, 'Warehouse', false,
     'Warehouse: the scheduled refresh copies the dataset from its data source. Stand-in: the dataset serves rows loaded from a file, is never refreshed from the warehouse, and every page that shows them says so.'),
  (4, 'note', 'Note', 'Data', null, false, null, false, 'Where the stand-in came from. Shown to everyone who sees its rows.'),
  (5, 'expected_by', 'Real data expected by', 'Date', null, false, null, false, 'When the warehouse is expected to have this data. Shown with the stand-in.'),
  (6, 'allowed_on_production', 'Allowed on production', 'Check', null, false, null, false,
     'A stand-in is refused on a production instance unless this is ticked for its dataset. The settings file cannot tick it.')
) as c(position, column_name, label, column_type, choices, reqd, default_value, read_only, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Dataset Binding' and d.column_name = c.column_name);
