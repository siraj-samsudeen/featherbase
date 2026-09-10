-- #245: deployment-wide, atomic public-route admission (not user metadata).
create table pre_auth_bucket (
  key text primary key,
  hits integer not null check (hits > 0),
  expires_at timestamptz not null,
  revision uuid not null
);
create index pre_auth_bucket_expiry on pre_auth_bucket (expires_at);
