## Why

An automated agent raises tickets through Tickets' `create` with a service account's access token, and `create` always records the caller as the raiser. So every such ticket names the service account: the person it is for does not find it among their own tickets and cannot take the raiser's steps, until a System Manager corrects each one with `change_raiser` (#1193).

## What Changes

- `create` takes an optional raiser: the person the ticket is raised for. Only a System Manager may name someone other than themselves (a service account holding that role included); anyone else is refused and no ticket is created. The raiser must be an enabled person. Naming yourself is an ordinary create.
- The named person holds everything a raiser holds from the start: the ticket is theirs, and on a private ticket its private details are theirs.
- The ticket's history gets one event saying who raised it on the named person's behalf. The platform's record of who created the ticket stays the caller, so the audit says who acted.

## Capabilities

### Modified Capabilities

- `tickets-raiser`: a System Manager may also name the raiser when raising a ticket.

## Impact

- Tickets 0.2.8, with an empty upgrade step from 0.2.7. No schema or grant change.
