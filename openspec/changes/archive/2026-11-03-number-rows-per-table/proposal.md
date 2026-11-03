## Why

People testing on staging saw rows named `46fcc60e47` and `0512e16c24`: ids
nobody can read, say or remember (#855). A new table falls back to a random
id unless its maker picks something else. And two tables that share a series
prefix draw from one count, so each skips the other's numbers: on staging,
plant 1001 became `SAP-PLANT-003` in one table and `SAP-PLANT-064` in its copy.

The owner decided (03-Nov-2026, on #855) that new tables number their rows
1, 2, 3, accepting that plain numbers can clash when rows move between
environments. A random id stays available as a choice.

## What Changes

- A new naming choice: plain numbers counted up from 1, with no prefix and no
  padding.
- A new table numbers its rows that way unless its maker picks another rule,
  whether it is made in the table builder, by importing a file, or by an app.
  Existing tables keep their rule.
- The builder shows how rows will be numbered, with sample ids, before the
  table is created (it already shows a sample for every rule).
- Every table keeps its own count, for plain numbers and prefixed series
  alike. Tables already numbered by a series carry on from the number their
  prefix last issued, so none reissues a number.
- A number already used by a row of the table, for example an id an import
  supplied, is skipped rather than refused.

Not in this change: lists linking each row by its display name (#792), and
what happens to plain-number ids when rows are copied to another environment
(noted out of scope by the owner).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `naming-and-numbering`: plain numbers as a naming choice and the default for
  new tables; a count per table; numbers already in the table are skipped.

## Impact

Observed on `origin/main` at `c49ab37e`: `resolveRowId` falls back to `hash`,
`createTable` stores `hash` when no rule is given, the builder and the import
wizard propose a series named after the table, and the series counter is keyed
by the prefix text alone. A data migration moves each series table's count to
its own key; it inserts rows only, leaving the old prefix counters in place.
