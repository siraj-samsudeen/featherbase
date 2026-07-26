-- API-005: API key + secret auth for integrations. Raw columns (not managed
-- Columns) so the generic row API never serializes them — same treatment as
-- password_hash.
alter table "user" add column if not exists api_key varchar(140);
alter table "user" add column if not exists api_secret_hash varchar(140);
create unique index if not exists user_api_key_uq on "user" (api_key) where api_key is not null;
