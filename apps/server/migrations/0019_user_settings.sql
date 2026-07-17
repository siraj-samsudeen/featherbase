-- UI-013: per-user, per-DocType view settings (list columns, filters, sort).
-- A plain infra table keyed by (user, doctype); the value is an opaque JSON
-- blob owned by the client view.
create table if not exists user_settings (
  "user" varchar(140) not null,
  doctype varchar(140) not null,
  settings jsonb not null default '{}'::jsonb,
  modified timestamptz not null default now(),
  primary key ("user", doctype)
);
