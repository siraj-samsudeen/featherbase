## Why

A loader that raises tickets leaves a service account as their raiser. A ticket type's cycle can hold steps only the raiser may take, so on those tickets nobody can ever take them. The raiser has to become a real person, without weakening the rule that protects the audit trail: nothing else may change who raised a ticket (#963).

## What Changes

- Tickets gets an action that changes who raised a ticket. It asks for the new raiser and a reason, and only a System Manager may take it (a service account holding that role included). Tickets support may not.
- The change is one history event on the ticket, reading by name: who raised it before, who raises it now, who changed it, when and why.
- The new raiser gets everything the raiser has, the private details of a private ticket included, and the old raiser loses it.
- Every other way of changing the raiser is still refused, a direct save included. There is no screen for this yet.
- An app's actions can ask whether a person is enabled, and a System Manager's action can hand one of the app's own rows to another person, so a grant on "rows you created" follows it.

## Capabilities

### New Capabilities

- `tickets-raiser`: a System Manager corrects who raised a ticket.

### Modified Capabilities

- `transactional-runtime-actions`: an action can ask who is enabled, and a System Manager's action can hand over one of the app's own rows.

## Impact

- Tickets 0.2.2, with an empty upgrade step from 0.2.1. No schema or grant change.
- `previousVersions` of the Jeyarama dash instance also lists Tickets 0.2.1, so an instance that reached it can upgrade.
