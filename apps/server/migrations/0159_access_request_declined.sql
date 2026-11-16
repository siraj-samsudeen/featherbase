-- #1173: a System Manager can decline a waiting request with a reason. The
-- request stays, marked declined, so the person is told and nobody is alerted
-- again; it goes once they can open the app by any route, like a waiting one.
alter table featherbase.access_request add column if not exists declined_at timestamp with time zone;
alter table featherbase.access_request add column if not exists declined_by character varying(140);
alter table featherbase.access_request add column if not exists declined_reason text;

insert into featherbase.column_def ("row_id", "parent", "position", "column_name", "label", "column_type", "reference_table", "reqd", "unique", "read_only", "hidden", "in_list_view", "tier", "parenttype", "parentfield", "custom", "description")
select gen_random_uuid()::text, 'Access Request', c.position, c.column_name, c.label, c.column_type, c.reference_table, false, false, true, false, c.in_list_view, 'basic', 'Table', 'columns', false, c.description
from (values
  (6, 'declined_at', 'Declined', 'Datetime', null, false, 'When a System Manager declined the request. Empty while it waits.'),
  (7, 'declined_by', 'Declined by', 'Reference', 'Person', false, 'The System Manager who declined it.'),
  (8, 'declined_reason', 'Reason', 'Text', null, false, 'Why it was declined. Only admins see it; the person is told only that it was declined.')
) as c(position, column_name, label, column_type, reference_table, in_list_view, description)
where not exists (select 1 from featherbase.column_def d where d.parent = 'Access Request' and d.column_name = c.column_name);
