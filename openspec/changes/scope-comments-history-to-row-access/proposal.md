# Proposal

## Why

Comments and edit history currently follow permission on their platform-wide storage tables, so a person can read activity for a row they cannot open. Activity must inherit the row's access and sensitive-column rules wherever it is read.

## What Changes

- Make comments and edit history visible only when the reader can read the row they belong to.
- Apply that rule consistently to row activity, direct activity-record reads, lists, counts, reports, search, and realtime subscriptions.
- Hide sensitive field changes from readers who cannot see those fields on the row.
- Make a direct share grant access to the chosen row and its ordinary fields without granting deeper access to restricted fields, either now or in its history.
- Keep the existing generic Comment list available for approved uses such as Tasker's latest-explanation view; narrow its results instead of removing it.
- Keep the System Manager-only team activity feed unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `comments-and-history`: comments and edit history inherit access to their referenced row and its visible fields on every read path.
- `permissions-and-roles`: direct shares grant row access without elevating the recipient's field tiers.

## Impact

The generic query and single-row read authorization for Comment and Version, direct-share field filtering on current rows, document activity responses, Admin and Tasker activity clients, report/search consumers of generic reads, and realtime subscription authorization are affected. A directly shared row remains readable or editable as granted, but restricted fields require the corresponding deeper field tier. This change does not alter unrelated permission defects (#338, #340, #341), redesign global search (#349), or change comment creation and mention behavior.
