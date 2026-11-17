-- Sign in with Microsoft (Entra ID work accounts). A new Sign In Method kind,
-- `microsoft`, through the shared sign-in pipeline; its own "expects
-- Microsoft sign-in" mark on Person, the twin of Google's (#473).

-- The mark, beside Google's on the Person form.
alter table featherbase.person add column if not exists expects_microsoft_sign_in boolean not null default false;

update featherbase.column_def set position = position + 1
where parent = 'Person' and position >= 3 and parenttype = 'Table' and parentfield = 'columns'
  and not exists (select 1 from featherbase.column_def where parent = 'Person' and column_name = 'expects_microsoft_sign_in');

insert into featherbase.column_def (row_id, parent, position, column_name, label, column_type, reqd, "unique", default_value,
  read_only, hidden, in_list_view, tier, parenttype, parentfield, custom, description)
select gen_random_uuid()::text, 'Person', 3, 'expects_microsoft_sign_in', 'Expects Microsoft sign-in', 'Check', false, false, '0',
  false, false, false, 'basic', 'Table', 'columns', false,
  'They can sign in with Microsoft using this email the first time; after that the link is permanent.'
where not exists (select 1 from featherbase.column_def where parent = 'Person' and column_name = 'expects_microsoft_sign_in');

-- A changed address clears both marks, unless the same save sets one: the
-- mark names the address it was set for.
create or replace function featherbase.fc_clear_expected_sign_in() returns trigger
  language plpgsql
  set search_path to 'pg_catalog'
  as $$
  begin
    if lower(trim(coalesce(old.email, ''))) is distinct from lower(trim(coalesce(new.email, ''))) then
      if not (new.expects_google_sign_in and not old.expects_google_sign_in) then
        new.expects_google_sign_in := false;
      end if;
      if not (new.expects_microsoft_sign_in and not old.expects_microsoft_sign_in) then
        new.expects_microsoft_sign_in := false;
      end if;
    end if;
    return new;
  end $$;

-- The kind's choice and its label.
update featherbase.column_def
set choices = E'password\ngoogle\nmicrosoft\ndelegated_password',
    choice_labels = coalesce(choice_labels, '{}'::jsonb) || '{"microsoft":"Microsoft"}'::jsonb
where parent = 'Sign In Method' and column_name = 'kind' and not custom
  and position(E'\nmicrosoft' in coalesce(choices, '')) = 0;

-- The method row, off until an administrator gives it a client id and turns
-- it on. Unknown people are refused; any work account may try (tenant
-- `organizations`, Siraj, 17-Nov-2026), and Featherbase decides who gets in.
insert into featherbase.sign_in_method (row_id, created_by, created_at, updated_at, updated_by, position, kind, label,
  enabled, new_person, allowed_email_domains, self_link, client_id, service_url, settings)
values ('microsoft', 'Administrator', now(), now(), 'Administrator', 0, 'microsoft', 'Microsoft',
  false, 'refuse', null, true, null, null, '{"tenant":"organizations"}')
on conflict (row_id) do nothing;
