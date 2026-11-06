## Why

Existing data-quality tickets are about to be loaded into production unassigned. The owner then reviews each one and assigns it, and that assignment should tell the person. Production has mail on from the start, so the load itself must send nothing (#1001).

An Email Rule can't do this: it matches one exact value, and it would address the Person ID that `assigned_to` holds. Apps have had no way to queue mail.

## What Changes

- Assigning or reassigning a ticket through `edit` emails the new assignee once, after the save commits. Rolled-back saves and retries send nothing more.
- Nothing is sent for: an unchanged assignee, a cleared assignee, assigning yourself, a person with no usable email (logged), or creating a ticket. `create` never sends, so a load is quiet even where a type's routing picks an assignee.
- The email holds the title, who assigned it, a link, and the description only if the assignee may read it.
- `?ticket=<id>` opens that ticket in the Tickets screen, so the link lands on it.
- Runtime actions gain `ctx.mail`: `mayRead` and `toPerson`. The platform resolves the address, so an app never sees it, and queues after the commit.

## Capabilities

### New Capabilities

- `tickets-assignment-email`: when assigning a ticket emails the person, and what the email holds.

### Modified Capabilities

- `transactional-runtime-actions`: an action can email a person after it commits.

## Impact

- Tickets 0.2.4, with an empty upgrade step from 0.2.3. No schema or grant change, and no platform migration.
- The Jeyarama dash instance's `previousVersions` gains Tickets 0.2.3. The default image's list is left alone in this change: its check lives in `.github/workflows/`, which another session is changing.
