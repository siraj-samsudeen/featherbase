## Why

Adding a role on a Person form gives an empty text box (#832). The administrator has to know and type the
exact role name, with nothing showing which roles exist. A link inside a grid of nested rows should work
like a link field on the form itself: matching rows are offered as you type.

## What Changes

- A link column in a grid of nested rows offers the linked Table's rows as the user types and keeps the one
  they pick, the same picker a link field on the form uses.
- Typed text that was never picked is not saved as a link; the save names the empty cell, and the server
  already refuses a link to a row that does not exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-forms`: a link in a grid of nested rows is picked from the linked Table's rows.

## Impact

The form's nested-row grid (web) reuses the form's existing link picker. No server, API, permission, schema
or migration change. A role's description in the picker needs a description on roles, which they do not
have; it is left out.
