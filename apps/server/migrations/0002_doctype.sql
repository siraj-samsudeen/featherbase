-- META-001: Table metadata storage. Model definitions live as rows here;
-- everything else (tables, APIs, forms) is generated from them.
create table table_def (
  name text primary key,
  module text not null default 'Core',
  kind text not null default 'table',
  is_submittable boolean not null default false,
  id_pattern text not null default 'hash',
  title_column text,
  sort_column text not null default 'updated_at',
  sort_order text not null default 'desc',
  track_changes boolean not null default true,
  description text,
  custom boolean not null default false,
  system boolean not null default false,
  created_by text not null default 'Administrator',
  updated_by text not null default 'Administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'draft',
  position integer not null default 0
);

create table column_def (
  name text primary key default gen_random_uuid()::text,
  parent text not null references table_def(name) on delete cascade,
  position integer not null default 0,
  column_name text not null,
  label text,
  column_type text not null,
  reference_table text,
  choices text,
  row_table text,
  reqd boolean not null default false,
  "unique" boolean not null default false,
  default_value text,
  read_only boolean not null default false,
  hidden boolean not null default false,
  in_list_view boolean not null default false,
  tier text not null default 'basic',
  created_by text not null default 'Administrator',
  updated_by text not null default 'Administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'draft',
  parenttype text not null default 'Table',
  parentfield text not null default 'columns',
  constraint column_def_parent_column_name unique (parent, column_name)
);

create index column_def_parent_position on column_def (parent, position);
