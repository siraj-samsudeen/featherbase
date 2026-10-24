-- #429: the Waiting for access page reads each person's first and last
-- sign-in ("user" + operation = 'login'), and the arrival alert looks up its
-- own row and counts the day's alerts (operation equal to, or starting with,
-- 'access_alert for '). Without these both scan the whole log.
create index if not exists activity_log_user_operation on activity_log ("user", operation, created_at);
create index if not exists activity_log_operation_pattern on activity_log (operation varchar_pattern_ops, created_at);
