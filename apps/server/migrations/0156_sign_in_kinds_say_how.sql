-- #731: a sign-in method's kind says how a person signs in, its row and label
-- who with: google becomes google_oauth, delegated_password external_password.
-- The rows keep their ids (google, stylehr); the sign-in actors keep their names.
update featherbase.sign_in_method set kind = 'google_oauth' where kind = 'google';
update featherbase.sign_in_method set kind = 'external_password' where kind = 'delegated_password';
update featherbase.column_def
set choices = E'password\ngoogle_oauth\nexternal_password',
    choice_labels = '{"password":"Password","google_oauth":"Google sign-in","external_password":"Password at an outside service"}'::jsonb
where parent = 'Sign In Method' and column_name = 'kind';
