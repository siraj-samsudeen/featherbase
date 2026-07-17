-- API-005: API key + secret auth for integrations. Raw columns (not
-- DocFields) so the generic document API never serializes them — same
-- treatment as password_hash.
alter table tab_user add column if not exists api_key varchar(140);
alter table tab_user add column if not exists api_secret_hash varchar(140);
create unique index if not exists tab_user_api_key_uq on tab_user (api_key) where api_key is not null;
