-- #446: a row's activity timeline reads its history and comments by the row's
-- Table and id, every read of a shared row looks up its shares the same way,
-- and renaming or deleting a row (#509, #321) finds its assignments,
-- notifications and workflow steps by that pair too. None of these had an
-- index on it, so each read scanned the whole store and slowed as it grew.
-- (file gets its own from patch 0001; tag_link has one from its creation.)
-- Migrations run in a transaction, so these are plain, not CONCURRENTLY; the
-- stores are small on every instance today.
create index if not exists version_ref_idx on version (ref_table, ref_name);
create index if not exists comment_ref_idx on comment (ref_table, ref_name);
create index if not exists share_ref_idx on share (share_table, share_name);
create index if not exists todo_ref_idx on todo (ref_table, reference_name);
create index if not exists notification_log_ref_idx on notification_log (ref_table, ref_name);
create index if not exists workflow_action_ref_idx on workflow_action (ref_table, ref_name);
