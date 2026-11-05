-- #628: holders of Access Auditor may open anyone's "What can this person
-- see" page. A built-in role, so an administrator only has to give it.
insert into featherbase.role (row_id, created_by, created_at, updated_at, updated_by, status, position, disabled)
values ('Access Auditor', 'Administrator', now(), now(), 'Administrator', 'draft', 0, false)
on conflict (row_id) do nothing;
