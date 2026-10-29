-- #693: Google's hosted-domain claim from a link's last sign-in, so the
-- way-in counts and the lockout guard apply the same rule as sign-in. ''
-- records that Google sent none; NULL (every row here before this step) means
-- never recorded: a possible way in, but not a proven one, until the link's
-- next sign-in records a claim.
-- email_verified: whether the last sign-in's address was verified (the email
-- column keeps the last address shown, verified or not); NULL before this step,
-- when only verified addresses were stored.
alter table featherbase.sign_in_identity add column if not exists hosted_domain varchar(255);
alter table featherbase.sign_in_identity add column if not exists email_verified boolean;
