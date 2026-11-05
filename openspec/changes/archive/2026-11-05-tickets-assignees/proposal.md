## Why

Tickets' `support_users` setting does two jobs: it gives support rights, and it fills the assign picker. So nobody can be offered for assignment without also getting support rights, such as triaging any ticket, publishing progress and opening any ticket's details. Staging keeps a wide support list only for that reason. It should come down to the two intended admins before production (#964).

## What Changes

- A new Tickets setting, `assignees`, lists people who may be assigned tickets. It is a JSON array of Person ids and gives no support rights.
- The assign picker offers those people, and everyone it offered before: support users, verification and fulfillment admins, and approvers.
- An empty or missing setting changes nothing.

## Capabilities

### New Capabilities

- `tickets-assignees`: who support can assign a ticket to, apart from who has support rights.

## Impact

- Tickets 0.2.3, with an empty upgrade step from 0.2.2. It adds a setting and changes no schema or grant.
- The default image and the Jeyarama dash instance's `previousVersions` gain Tickets 0.2.2, so an instance holding it can upgrade from its exact files.
