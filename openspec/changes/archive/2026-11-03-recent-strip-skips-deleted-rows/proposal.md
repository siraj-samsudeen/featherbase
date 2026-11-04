## Why

Item 3 of #741: the Recent chips above a Table's list kept a row after it was
deleted, and the chip led to an error page. The trail outlives the rows it
names.

## What Changes

- The Recent chips above a Table's list offer only rows that still exist and
  that the user can read. A deleted row's chip leaves.
- Out of scope: the sidebar's "Recently opened" list and Home's "Continue
  where you left off", which #873 covers.

## Impact

- `apps/web/src/components/ListView.tsx` (`RecentStrip`), using the existing
  `POST /api/row_titles`. No server change.
