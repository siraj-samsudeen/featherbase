-- #1060: a Permission row is a grant and is no longer retired: a grant ends by
-- unticking it in the permission matrix. A retired grant always kept granting,
-- so clearing the marks changes no one's access; the history entry that
-- recorded each retirement stays.
update featherbase.permission set retired_at = null, retired_by = null, retired_reason = null
where retired_at is not null or retired_by is not null or retired_reason is not null;
