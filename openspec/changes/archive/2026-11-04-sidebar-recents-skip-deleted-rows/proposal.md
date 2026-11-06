## Why

#898: the sidebar's "Recently opened" and "Frequent", and the command bar's
empty-state Recent and Frequent groups, kept a row after it was deleted, and
its link led to an error page. Siraj decided on 2026-11-04 that they hide
deleted rows, as the Recent chips above a Table's list have since #741.

## What Changes

- The sidebar and the command bar offer only remembered rows that still
  exist and that the user can read. The history itself is kept; a freed slot
  goes to the next remembered destination.
- Deleting a row from its form, or in bulk from the list, takes it out of
  these lists at once.
- Out of scope: Home's "Continue where you left off", the activity trail and
  deleted or renamed Tables, which #873 covers.

## Impact

- `apps/web/src/lib/row-titles.tsx` (`useLiveDestinations`, sharing the row
  title cache), `apps/web/src/pages/AdminLayout.tsx`, and the delete paths in
  `FormView.tsx` and `ListView.tsx`. Uses the existing `POST /api/row_titles`;
  no server change.
