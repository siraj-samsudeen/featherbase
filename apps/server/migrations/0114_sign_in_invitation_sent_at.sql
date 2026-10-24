-- #430: when the invitation email for a pending Google invite was last sent.
-- Null = never sent (not requested, or the send failed). A resend is refused
-- within ten minutes of it (src/invitation-email.ts).
alter table featherbase.sign_in_identity add column if not exists invitation_sent_at timestamptz;
