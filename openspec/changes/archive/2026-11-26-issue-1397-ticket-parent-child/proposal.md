## Why

The MotherDuck sync raises one ticket per account it cannot link to a person: 67 loose tickets on production, crowding the Tickets queue (#1397).

## What Changes

- A ticket may sit under a parent ticket, one level deep. `create` takes an optional parent; `edit` lets support set or clear it.
- The queue lists only tickets without a parent; a parent's row counts its sub-tickets. A search still finds a sub-ticket.
- A parent's page lists its sub-tickets with their states; a sub-ticket's page names its parent.
- The MotherDuck sync files each ticket it raises under one umbrella ticket, resolves the umbrella when none is open, and reopens that same umbrella when a new one is raised.

## Capabilities

### New Capabilities

- `tickets-sub-tickets`: a ticket under a parent ticket.

### Modified Capabilities

- `motherduck-accounts`: the review tickets sit under one umbrella ticket.
