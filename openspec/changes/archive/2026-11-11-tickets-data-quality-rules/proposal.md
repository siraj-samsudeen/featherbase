## Why

A master-data gap that one filter describes ("Buyer is blank") is logged today as one data quality row per
affected row. One production ticket reached 172 rows, 109 of them saying only "person is blank", and nobody could
tell at a glance how much was left (#1196). A gap like this should be one rule on the ticket: a table, a filter,
and a live count of the rows that still match, with a link to them.

## What Changes

- A ticket can carry **data quality rules**. Each names a linked instance Table, its filter conditions, a
  severity, an owner and how to fix it. Tickets stores how many rows matched when it was raised, and counts
  what is left each time the ticket is opened, as the viewer.
- A rule at 0 reads **All clear**; it shows rows again if new ones match.
- The ticket page shows a **Rules** card in one of three layouts (List, Table, Tiles), each rule linking to
  the matching rows in the platform's list. People involved in the ticket add a rule with a live
  "matches N rows" preview, or remove one with a reason kept in history. The Next step card warns while
  rules still have rows to fix.
- An app's actions and reads can **count** rows of a Table they may read, as the caller.
- The platform's filters gain **is blank** and **is not blank**: empty, or empty text.

## Capabilities

### New Capabilities

- `tickets-data-quality-rules`: a rule on a ticket, its live count, and how it is added, shown and removed.

### Modified Capabilities

- `transactional-runtime-actions`: an action or read counts rows as its caller.
- `list-view`: the is blank and is not blank filters.

## Impact

- Tickets 0.2.8 adds the `tickets.data_quality_rule` Table, with an empty upgrade step from 0.2.7.
- A rule reads only Tables an administrator lists in Tickets' `linked_tables` setting.
