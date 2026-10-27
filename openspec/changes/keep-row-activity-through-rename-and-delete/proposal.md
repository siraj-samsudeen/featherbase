## Why

A row's comments, change history, attachments and shares name it by its id. Renaming a row left them all behind under the old id, so the renamed row lost its timeline and files (#509). Deleting a plain row left them behind too, pointing at a row that no longer exists, and a share link stayed live for any later row given the same id (#321). The owner chose to refuse such deletes, as installed apps' rows already are, so nothing is ever lost. Opening a row's history also read the whole history store each time (#446).

## What Changes

- Renaming a row carries along everything that names it: comments, history, attachments, shares, assignments, tags, notifications, emails, access entries and row-level access limits.
- Deleting a row is refused while it has comments, history, attachments or shares, and the refusal says how many of each.
- A row's history is found by an index rather than a scan.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a renamed row keeps its activity.
- `row-deletion`: a row with comments, history, attachments or shares can't be deleted.

## Impact

Server rename and delete operations, one new index migration (0126), server tests and these spec deltas. Rows that have been edited can no longer be deleted while their Table keeps history; that is the owner's choice (27-Oct-2026). No new endpoints, settings or permissions.
