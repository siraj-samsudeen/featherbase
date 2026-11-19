-- ask-questions-of-app-data: a question is answered by SQL first, and by a
-- plan when the SQL cannot be used. The SQL that answered a question is kept
-- with it; plan stays for the questions a plan answered.
alter table featherbase.app_question add column if not exists sql text;
