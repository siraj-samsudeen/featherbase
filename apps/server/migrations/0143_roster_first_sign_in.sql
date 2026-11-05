-- #970: a sign-in method may make a person from a staff roster row. The whole
-- list is set, not compared first: a checkout with Windows line endings stores
-- the baseline's list with them, and an exact comparison would then skip it.
update featherbase.column_def
set choices = E'refuse\ncreate_if_email_domain_allowed\ncreate\ncreate_if_on_roster',
    choice_labels = coalesce(choice_labels, '{}'::jsonb) || '{"create_if_on_roster":"Create if on the staff roster"}'::jsonb
where parent = 'Sign In Method' and column_name = 'new_person' and not custom;
