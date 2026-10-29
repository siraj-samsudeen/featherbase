-- #693: Google's hosted-domain claim from a link's last sign-in, so the
-- way-in counts and the lockout guard apply the same rule as sign-in. Rows
-- installed before this step start with none recorded (treated as "no claim").
alter table featherbase.sign_in_identity add column if not exists hosted_domain varchar(255);
