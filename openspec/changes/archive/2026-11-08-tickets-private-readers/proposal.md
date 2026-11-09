## Why

On a ticket type whose details are private, only the raiser and support read the request. The person a ticket is assigned to, and the person it is raised for, cannot read what they are asked to act on, unless they are made support for every ticket (#925).

## What Changes

- On a private ticket, its current assignee and the person in its type's `raised_for` field read the request as the raiser does: its details, its earlier wordings and which actions were taken. Support's own history stays with support.
- They stop reading it when they are no longer named: a reassigned assignee, or a person no longer raised for. A colleague who is not named reads nothing more than before.
- The assignment email to a private ticket's assignee now carries its description, since they read it on the ticket.
- An app's action can name the people who read one row of its own Tables, read only, kept as shares the platform already honours when a row is opened. A read can ask whether it was named.

## Capabilities

### Modified Capabilities

- `tickets-type-transitions`: a private type's details are also read by the ticket's assignee and the person it is raised for.
- `tickets-assignment-email`: a private ticket's assignee gets its description.
- `transactional-runtime-actions`: an action names a row's readers; a read asks whether its caller is one.

## Impact

- Tickets 0.2.6, with an empty upgrade step from 0.2.5. No schema or grant change. The dash instance's previous versions list 0.2.5.
- A private ticket raised before this version gets its readers the next time it is assigned or edited.
