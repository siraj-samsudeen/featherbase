## Why

When support picks Unassigned in a ticket's header, the confirm row asks "Remove the assignee?" but its button says "Assign". The button names the wrong act (#1233, found by the UI verifier).

## What Changes

- The confirm row for Unassigned offers **Remove** and Cancel. Assigning a person still offers Assign and Cancel.

## Capabilities

### Modified Capabilities

- `tickets-assignment-email`: the remove confirm's button says Remove.

## Impact

- Tickets 0.2.15, an empty upgrade step from 0.2.14. Wording only; what is saved is unchanged.
