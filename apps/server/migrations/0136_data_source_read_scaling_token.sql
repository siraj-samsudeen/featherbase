-- #625 (design E3, Codex round 1): an app's dataset query must not be able to
-- change its source. Postgres runs it in a read-only transaction and a local
-- DuckDB file is opened read-only, but a MotherDuck connection cannot be
-- opened read-only: what keeps it read-only is a read-scaling token
-- (https://motherduck.com/docs/key-tasks/authenticating-and-connecting-to-motherduck/read-scaling/),
-- which the platform cannot detect. An administrator ticks this box to say the
-- source's token is one; until then a MotherDuck source cannot back an app
-- dataset. Adds a column with a default; no existing row changes meaning.
alter table featherbase.data_source add column if not exists read_scaling_token boolean not null default false;

insert into featherbase.column_def (parent, position, column_name, label, column_type, default_value)
select 'Data Source', coalesce((select max(position) + 1 from featherbase.column_def where parent = 'Data Source'), 0),
       'read_scaling_token', 'Read-scaling token (MotherDuck, read-only)', 'Check', '0'
where not exists (
  select 1 from featherbase.column_def where parent = 'Data Source' and column_name = 'read_scaling_token'
);
