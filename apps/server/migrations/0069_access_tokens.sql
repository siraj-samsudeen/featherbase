-- #131: named access tokens replace the API-005 per-user key pair as THE
-- integration credential. Raw table (not a managed Table) so credentials
-- never travel through the generic row API — same treatment as password_hash.
-- The token plaintext ("fbt_" + 32 random bytes) is shown once at creation;
-- only its SHA-256 is stored. High-entropy tokens need no per-row salt, and a
-- deterministic hash keeps the auth lookup a single indexed select.
-- #137: a developer database may already carry an `access_token` table from a
-- user-defined Table named "Access Token" (metadata Tables compile to the
-- lowercased name). `if not exists` would silently adopt it and the schema
-- below would never be applied, leaving authentication querying columns that
-- do not exist. Fail here instead, with the remedy in the message.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = current_schema() and table_name = 'access_token')
     and not exists (select 1 from information_schema.columns
                     where table_schema = current_schema()
                       and table_name = 'access_token' and column_name = 'token_hash')
  then
    raise exception 'a table named "access_token" already exists and is not the '
      'credential store (no token_hash column). It is most likely a Table named '
      '"Access Token" — rename or drop it, then re-run migrations.';
  end if;
end $$;

create table if not exists access_token (
  id varchar(140) primary key,
  label varchar(140) not null,
  owner varchar(140) not null references "user"(name) on delete cascade,
  token_hash char(64) not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists access_token_owner_ix on access_token (owner);

-- Service accounts are user rows that can never sign in interactively.
-- Raw column: settable only through the dedicated endpoints/CLI, never the
-- generic doc API.
alter table "user" add column if not exists user_type varchar(20) not null default 'human';

-- API-005 retired outright (owner-sanctioned in #131): the per-user key pair
-- and its "Authorization: token key:secret" scheme are gone.
alter table "user" drop column if exists api_key;
alter table "user" drop column if exists api_secret_hash;
