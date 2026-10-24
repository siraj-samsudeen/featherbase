# Proposal

## Why

A System Manager can do anything on any table today, and that includes the
records meant to hold them to account. On a live instance an administrator
could open the activity record, add a sign-in that never happened, or delete
one that did. A record its own administrators can forge or erase is not a
record (issue #432).

## What Changes

- Platform records that only the system produces — activity and access
  history, change history, background jobs and their runs, the email queue,
  import history, notifications, usage events and dataset refreshes — are
  marked as written by the platform only.
- Nobody can create, change, delete, rename, import into, merge into or
  change the columns of those records: not a System Manager, not the
  Administrator, not an access token. Reading them is unchanged.
- The platform keeps writing them as before: signing in is still recorded,
  jobs still record their runs, imports still log themselves, saves still
  leave history.
- The screens drop every write control on those records and open them for
  reading only.
- Configuration cannot reach those records from the side: no script,
  metadata override, workflow or custom field may target them, and the
  platform's own writes ignore any that pre-date this change.
- Whether a table is written by the platform only is decided by the storage
  it reaches, and no two tables may share storage, so a table spelled like a
  platform record cannot reach it. A data source cannot point at the
  platform's own database or connect a table to the platform's schema.
- Deleting a table keeps its history (change, import, email and notification
  records), and that history never acts on a later table of the same name.
- Work an administrator genuinely needs, such as retrying a failed job or
  queueing an email, stays a dedicated action rather than a general edit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `permissions-and-roles`: the System Manager's reach stops at records the
  platform alone writes; a new promise that those records cannot be forged or
  erased by anyone.
- `table-deletion`: deleting a table keeps its history instead of sweeping it.
- `external-data-sources`: a data source never reaches the platform's own
  database or schema.

## Impact

One migration (0109) adds the marker to Table metadata and sets it on the
twelve platform records. The server's save, delete, rename, submit, import,
row-action and column-change paths refuse a marked table before any
permission check. The import logger moves to a dedicated internal save path.
The list, form, connections panel and command bar hide write controls from
the table's metadata.
