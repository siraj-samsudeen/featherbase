## Why

A data quality ticket covers rows that the instance records in its own Data Quality Row Table (each linked to its ticket since 16-Nov-2026), but Tickets shows none of them. Its Evidence tab is support-only, so a reader opening the ticket sees "Evidence is private to support" and nothing about which rows are wrong (#1230).

## What Changes

- The ticket page's Request tab lists the rows the ticket covers, to everyone who can see the ticket: the Table and row, what's wrong, fixed (with its date) or open, under a count such as "10 rows · 3 fixed".
- A row links to its Featherbase record only for a viewer who may read that row; for anyone else it is plain text.
- Tickets reads Data Quality Row as a declared base Table, only the five columns shown, and only once an administrator lists it in Tickets' `linked_tables`. Until then the page opens as before and support is told how to switch the list on.

## Capabilities

### Modified Capabilities

- `tickets-data-quality-rules`: the ticket page also lists the rows the ticket covers.

## Impact

- Tickets 0.2.10, with an empty upgrade step from 0.2.9. No Table and no grant is added; the manifest declares `baseTables.read` for Data Quality Row.
- Instance step: an administrator adds `Data Quality Row` to Tickets' `linked_tables`.
