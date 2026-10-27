# Design

## Context

Owner decisions on #651 (27-Oct-2026): every operation ships now; a
data-removing step needs `destructive: true` plus a per-instance loss report
from the release check and `cli migrate:rehearse`; type changes are safe
conversions only. The work reuses the table-edit safety paths of #250/#251
("one engine").

## Decisions

**D1. Each operation carries what it removes or replaces.** `dropTable` and
`dropColumn` declare the table or column as it stood (and optionally the
column's position); `alterColumn` names `from` and `to` for the same
properties. This keeps the existing contract checkable at load time for every
operation: undoing the history from the final declaration gives a baseline,
and replaying the history forward from that baseline must give the final
declaration back. The upgrade planner replays the pending history forward from
the installed declaration and compares it with the target's.

**D2. `destructive: true` sits on the operation, not on the whole step.** A
flag on the step would also cover operations the author did not mean to lose
data. A `dropTable` or `dropColumn` without it keeps the version from loading.
An `alterColumn` that narrows choices, or turns a text column into a choice,
is checked against the instance's rows: if rows hold values outside the new
choices and the operation is not marked, the preview refuses; if it is
marked, those values are cleared and counted.

**D3. Safe conversions.** Int to Float; Data to Text, Long Text or Choice;
Text and Long Text either way; Choice to Text or Long Text; Date to Datetime;
Check to Int. Anything else is refused at load: add a new column, copy the
data, then drop the old one.

**D4. Required columns are filled first.** A required column added to an
existing table needs a default or a `backfill`; an `alterColumn` that makes a
column required fills empty values from its `backfill` (or default) and fails
the whole upgrade if any row is still empty. A unique column is never
backfilled with one value.

**D5. Renaming a table is an engine operation for apps only.** It renames the
stored table and every name Postgres or the engine built from it (primary
key, NOT NULL constraints, unique rules, the Sub-table index, the read
policy), moves the definition, and repoints every link column, child row,
history and grant that names it. A table linked from another app's table
cannot be renamed. Administrators still cannot rename an app's table.

**D6. Grants.** The "never widen a grant" rule is kept for every table the app
already had; a renamed table's grants follow it. A table the upgrade adds
arrives with exactly the grants this version declares for it, listed in the
preview and created inside the upgrade's transaction, with the roles the
version declares. Withdrawn grants are removed before any table is renamed.

**D7. Loss counts stay out of the plan's identity.** The preview shows the
counts, but the plan id the administrator approves does not depend on them,
so rows saved between preview and apply do not make the review stale. The
activity log records what each destructive step removed, as counts.

**D8. Fresh install equals upgrade.** Proven by installing 0.3.0 of the
`evolve` fixture directly and by upgrading 0.1.0 to 0.2.0 to 0.3.0, then
comparing table and column definitions, stored columns (by name: Postgres
cannot reorder stored columns), indexes, constraints, read policies, grants
and the app's table registry.

## Not done here

- Changing a table's own properties (label, title column, row naming,
  `decides_scope`) through an upgrade. The planner still refuses any change
  the history does not declare, so the scope mark and its security guard stay
  as installed.
- Converting values with an expression. Only the safe list above.
