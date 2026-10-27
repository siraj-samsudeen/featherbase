# Proposal

## Why

Changing or deleting many rows at once from a list was the riskiest click in
the Admin. It deleted every selected row at once with no confirmation (#327).
When one row failed partway, the rows before it stayed changed, the rows
after it were never tried, and the person saw one error without knowing
which rows had changed (#332). A refused edit said only "Invalid values" and
did not name the field or the reason (#540).

## What Changes

- Changing or deleting many rows is all-or-nothing on the platform's own
  tables. If one row can't be changed, no row changes, and the message names
  that row and why.
- A table connected to an outside source can't share that all-or-nothing
  step. There every row is tried, and the rows that failed stay selected,
  each named with its reason.
- A refused change names each refused field and why.
- Deleting several rows asks first, naming how many rows will go.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`: a change to many rows is all-or-nothing, a refusal names the
  field and why, and deleting many rows asks first.

## Impact

Two new write actions on every Table, `:bulk-edit` and `:bulk-delete`, which
the list's bulk bar now calls once instead of once per row. The list's bulk
bar gains a confirmation dialog for delete.
