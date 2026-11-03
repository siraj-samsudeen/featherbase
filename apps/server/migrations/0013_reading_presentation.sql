-- #834: one metadata-driven reading presentation; no message conversion.
-- Configured through validated Table definitions, not a free-form row JSON control.
alter table featherbase.table_def add column reading_presentation jsonb;

update featherbase.table_def set
  title_column = coalesce(title_column, 'subject'),
  reading_presentation = '{"title":"subject","headers":["mail_from","mail_to","created_at"],"body":"body","attachment_names":"attachment_names","notice":"Captured locally in Email Sink. This does not confirm external delivery."}'::jsonb
where name = 'Email Sink';

-- Only replace platform defaults, never authored labels or a translation key.
update featherbase.column_def as c set label = labels.label
from (values
  ('mail_from', 'From'), ('mail_to', 'To'), ('subject', 'Subject'),
  ('body', 'Message'), ('attachment_names', 'Attachments'),
  ('attachment_b64', 'First attachment payload')
) as labels(column_name, label)
where c.parent = 'Email Sink' and c.column_name = labels.column_name
  and c.custom = false and c.label = c.column_name
  and not exists (select 1 from featherbase.translation t where t.source_text = c.label);
