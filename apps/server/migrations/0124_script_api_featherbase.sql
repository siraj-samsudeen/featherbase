-- 26-Oct-2026: the object Server Scripts and Client Scripts call is now named
-- `featherbase` (featherbase.throw(msg), featherbase.ui.form.on(table, handlers));
-- it was `frappe`, from the project's start as a Frappe replication. The runtimes
-- no longer define `frappe`, so stored script source is rewritten to match. Only
-- the identifier `frappe` used as an object (`frappe.` member access) changes:
-- a `frappe.` preceded by a letter, digit, `_`, `$` or `.` is part of another
-- name and is left alone, as is any other text that mentions the word.
update featherbase.server_script
   set script = regexp_replace(script, '(^|[^[:alnum:]_$.])frappe\.', '\1featherbase.', 'g')
 where script ~ '(^|[^[:alnum:]_$.])frappe\.';

update featherbase.client_script
   set script = regexp_replace(script, '(^|[^[:alnum:]_$.])frappe\.', '\1featherbase.', 'g')
 where script ~ '(^|[^[:alnum:]_$.])frappe\.';
