-- @spec external_enrollment_requires_explicit_authority
-- Preserve configured client identity, never guess external subjects from emails.
insert into featherbase.login_provider (id, kind, issuer, client_id, enabled)
select gen_random_uuid()::text, 'google', 'https://accounts.google.com', value, true
from featherbase.single_value
where table_name = 'System Settings' and field = 'google_client_id'
  and value is not null and btrim(value) <> ''
on conflict (kind, issuer, client_id) do nothing;

delete from featherbase.single_value where table_name = 'System Settings'
  and field in ('google_client_id', 'allowed_login_domains');
delete from featherbase.column_def where
  (parent = 'System Settings' and column_name in ('google_client_id', 'allowed_login_domains'))
  or (parent = 'User' and column_name = 'social_login');
alter table featherbase."user" drop column if exists social_login;
