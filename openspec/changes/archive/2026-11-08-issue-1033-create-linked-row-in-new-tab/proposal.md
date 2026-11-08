## Why

Choosing to create a new linked row from a link field's list left the form in the same tab, so whatever had been typed on the form was lost (#1033).

## What Changes

- Creating a new row from a link field's list opens that row's blank form in a new tab. The form the person was filling in stays as it was, in its own tab.
- Back on the form, the new row can be found and picked in the same link field.

## Capabilities

### Modified Capabilities

- `core-forms`: creating a linked row keeps the form being filled in.

## Impact

- `apps/web/src/components/FormView.tsx`. No migration.
