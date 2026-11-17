## Why

In Siraj's review of the ticket page on 17-Nov-2026 (#1252), "rows" told a store user nothing: "rows is too generic - meaning?". The rows a data quality ticket covers are the records it says are wrong: sections, subcategories, assignments.

## What Changes

- The ticket page names them records: the header fact "Records To Fix: 3 · 1 fixed", the table "Records this ticket covers" under "3 records · 1 fixed", the column "Record", and group lines such as "Section · 2 records · 1 fixed".
- Short labels and headings on the ticket page are in Title Case ("Assigned To", "Original Message"); phrases stay in sentence case.
- The header shows as many actions as buttons as fit its width; only the rest go under More.

## Capabilities

### Modified Capabilities

- `tickets-data-quality-rules`: the list of covered rows reads "3 records · 1 fixed".

## Impact

- Tickets 0.2.19, an empty upgrade step from 0.2.18. Wording and layout only; what is read and saved is unchanged.
