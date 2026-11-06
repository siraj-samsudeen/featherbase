## Why

Every Table reserves the column name `status` for the submit lifecycle (draft, submitted, cancelled), even a Table nobody submits. A person designing a master table can't use the most natural name for an open or closed site (#1022).

## What Changes

- The lifecycle column is `submission_status` on every stored Table, and in every row the API returns. `submission_status` is now the reserved name.
- `status` is an ordinary column name. Its values mean nothing to the platform: `cancelled` there locks nothing, and a workflow doesn't touch it.
- **BREAKING** The row field and filter `status` no longer mean the lifecycle. Nothing outside this repo depends on them yet.
- SLA escalation reads fulfilled states from a Table's own `status` column when it has no workflow.
- Migration `0151` renames the column on every stored Table and refuses a Table where either name already holds something else. `person_match` keeps its own `status`.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: which column names are free, and which column holds the lifecycle.

## Impact

- Server, shared and Admin code that reads or writes the lifecycle, and the repeated name lists. No app's code reads the column, so no app version changes.
- Not zero-downtime: while the old code serves during pre-deploy, its sign-ins and most of its writes fail. The PR records exactly what a person sees.
- The warehouse mirrors need a resnapshot; a new baseline takes the new shape.
