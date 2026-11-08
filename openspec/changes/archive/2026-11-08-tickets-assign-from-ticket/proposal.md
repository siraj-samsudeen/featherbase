## Why

The owner opened a ticket and couldn't see how to move it or assign it. Assigning lived only inside the Edit request form, and nothing on the ticket pointed to it. On a type with actions an unassigned ticket shows no actions, so it looked stuck (#1069).

## What Changes

- Support sees "Assigned to" in the ticket's header as a picker, listing Unassigned and the same people the Assign to field listed.
- Picking only asks. A confirm row reads "Assign to <person> and email them?", "Assign to yourself?" or "Remove the assignee?", with Assign and Cancel. Cancel restores the current assignee and saves nothing.
- Assign saves through the existing `edit` action, so the #1001 mail rules hold unchanged: one email to someone else, none for yourself or Unassigned. A ticket someone else changed first is refused and nothing is saved.
- Anyone who isn't support sees the assignee as plain text.
- The Assign to field leaves the Edit request form, so there is one way to assign.

## Capabilities

### Modified Capabilities

- `tickets-assignment-email`: support assigns in the ticket's header, after a confirm; the Edit request form no longer assigns.

## Impact

- Tickets 0.2.5, with an empty upgrade step from 0.2.4. No schema, grant or server change.
- The Jeyarama dash instance's `previousVersions` gains Tickets 0.2.4.
