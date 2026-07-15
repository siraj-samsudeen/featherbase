-- META-001: DocType metadata storage. Model definitions live as rows here;
-- everything else (tables, APIs, forms) is generated from them.
create table doctype (
  name text primary key,
  module text not null default 'Core',
  issingle boolean not null default false,
  istable boolean not null default false,
  is_submittable boolean not null default false,
  autoname text not null default 'hash',
  title_field text,
  sort_field text not null default 'modified',
  sort_order text not null default 'desc',
  track_changes boolean not null default true,
  description text,
  custom boolean not null default false,
  owner text not null default 'Administrator',
  modified_by text not null default 'Administrator',
  creation timestamptz not null default now(),
  modified timestamptz not null default now()
);

create table docfield (
  name text primary key default gen_random_uuid()::text,
  parent text not null references doctype(name) on delete cascade,
  idx integer not null default 0,
  fieldname text not null,
  label text,
  fieldtype text not null,
  options text,
  reqd boolean not null default false,
  "unique" boolean not null default false,
  default_value text,
  read_only boolean not null default false,
  hidden boolean not null default false,
  in_list_view boolean not null default false,
  permlevel integer not null default 0,
  constraint docfield_parent_fieldname unique (parent, fieldname)
);

create index docfield_parent_idx on docfield (parent, idx);
