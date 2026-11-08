-- #1060: a Permission row is a grant and is never retired: a grant ends by
-- unticking it in the permission matrix. A new database gets no retirement
-- columns on permission (0147 skips Tables that cannot retire), so an existing
-- one drops them too. A retired grant always kept granting, so this changes
-- no one's access; the history entry that recorded each retirement stays.
alter table featherbase.permission
  drop column if exists retired_at,
  drop column if exists retired_by,
  drop column if exists retired_reason;
