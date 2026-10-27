## Why

A row's comments, change history, attachments and shares name it by its id. Renaming a row left them all behind under the old id, so the renamed row lost its timeline and files (#509). Deleting a plain row left them behind too, pointing at a row that no longer exists, and a share link stayed live for any later row given the same id (#321). Opening a row's history also read the whole history store each time (#446).

## What Changes

- Renaming a row carries along everything that names it: comments, history, attachments, shares, assignments, tags, notifications, emails, access entries and row-level access limits.
- Deleting a row leaves nothing behind that still names it.
- A row's history is found by an index rather than a scan.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a renamed row keeps its activity.
- `row-deletion`: deleting a row leaves nothing pointing at it.

## Impact

Server rename and delete operations, one new index migration (0126), server tests and these spec deltas. No new endpoints, settings or permissions.
