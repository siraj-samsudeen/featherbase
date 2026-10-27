-- #446: a row's activity timeline reads its history and comments by the row's
-- Table and id, and every read of a shared row looks up its shares the same
-- way. None of the three had an index on that pair, so each read scanned the
-- whole store and slowed as it grew (file and tag_link already have theirs).
-- Migrations run in a transaction, so these are plain, not CONCURRENTLY; the
-- stores are small on every instance today.
create index if not exists version_ref_idx on version (ref_table, ref_name);
create index if not exists comment_ref_idx on comment (ref_table, ref_name);
create index if not exists share_ref_idx on share (share_table, share_name);
