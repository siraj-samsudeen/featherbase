## Why

Support's assign picker left out anyone configured for Tickets who hadn't used it yet. Tickets learns a name only when that person acts, and Tickets Support can't read Person. So a person newly listed in `assignees` couldn't be picked (#1097, found by the #1069 verifier).

## What Changes

- `ctx.people.names` in runtime actions and reads names a person whom the app's own settings name, even when the viewer can't read Person. Every other id is still read with the viewer's Person permission.
- Tickets needs no change: its picker already asks the platform for the names of people it hasn't met.

## Capabilities

### Modified Capabilities

- `tickets-assignees`: the picker offers configured people by name before they have used Tickets.

## Impact

- Platform only (`people-directory.ts`, `runtime-actions.ts`). No schema, grant or app version change.
