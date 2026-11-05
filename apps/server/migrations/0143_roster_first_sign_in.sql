-- #970: a sign-in method may make a person from a staff roster row.
update featherbase.column_def
set choices = E'refuse\ncreate_if_email_domain_allowed\ncreate\ncreate_if_on_roster',
    choice_labels = coalesce(choice_labels, '{}'::jsonb) || '{"create_if_on_roster":"Create if on the staff roster"}'::jsonb
where parent = 'Sign In Method' and column_name = 'new_person'
  and choices = E'refuse\ncreate_if_email_domain_allowed\ncreate';
