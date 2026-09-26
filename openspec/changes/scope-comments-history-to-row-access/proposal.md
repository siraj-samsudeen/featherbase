# Proposal

## Why

Comments and edit history currently follow permission on their platform-wide storage tables, so a person can read activity for a row they cannot open. Activity must inherit the row's access and sensitive-column rules wherever it is read.

## What Changes

- Make comments and edit history visible only when the reader can read the row they belong to.
- Apply that rule consistently to row activity, direct activity-record reads, lists, counts, reports, search, and realtime subscriptions.
- Hide sensitive field changes from readers who cannot see those fields on the row.
- Keep the existing generic Comment list available for approved uses such as Tasker's latest-explanation view; narrow its results instead of removing it.
- Keep the System Manager-only team activity feed unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `comments-and-history`: comments and edit history inherit access to their referenced row and its visible fields on every read path.

## Impact

The generic query and single-row read authorization for Comment and Version, document activity responses, Admin and Tasker activity clients, report/search consumers of generic reads, and realtime subscription authorization are affected. Direct shares currently give full sensitive-field visibility in single-row reads; whether their edit history inherits that visibility requires owner ratification before implementation. This change does not alter unrelated permission defects (#338, #340, #341), redesign global search (#349), or change comment creation and mention behavior.
