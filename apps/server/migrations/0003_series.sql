-- META-006: naming series counters, incremented atomically at insert time.
create table series (
  name text primary key,
  current bigint not null default 0
);
