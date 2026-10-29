-- #693: Google's hosted-domain claim from a link's last sign-in, so the
-- way-in counts and the lockout guard apply the same rule as sign-in. ''
-- records that Google sent none; NULL (every row here before this step) means
-- never recorded, counted on the link's email domain until its next sign-in.
alter table featherbase.sign_in_identity add column if not exists hosted_domain varchar(255);
