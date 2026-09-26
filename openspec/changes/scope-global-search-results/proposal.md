# Proposal

## Why

A person may be allowed to open the Customers table while being limited to
their own customers or one region. Search currently reveals the names and row
IDs of other customers, even though the person cannot open those rows.

## What Changes

- Apply the same own-row and chosen-row limits to search that already protect
  lists, forms and counts.
- Prevent search from matching or displaying a sensitive title the person is
  not allowed to read, while keeping the row searchable by its ID.
- Add concrete search examples for a person's own rows and region-limited
  customer access, and for each sensitive-title case.
- Keep search's existing result limits and exclusion of connected outside
  databases unchanged.
- Keep discovery of individually shared rows unchanged: a known shared link can
  still be opened, but this change does not add shared rows to search or lists.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `permissions-and-roles`: State that own-row and chosen-row limits also apply
  when a person searches, and that search cannot use a sensitive field the
  person cannot read.
- `search-and-explore`: State that a readable table does not make every row in
  that table searchable; each result must be a row and title the person is
  allowed to read.

## Impact

The server's global row search and its permission-focused tests will change.
The search interface, result shape, result limits, connected-table behavior,
direct-share discovery and all non-search permission behavior remain unchanged.
