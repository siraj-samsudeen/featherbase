# Proposal

## Why

A summary lists at most 500 rows, but it used to count, total, chart and export only those 500 while its row count named the true number. On a larger Table the totals on screen and in the downloaded file were silently too low, and nothing told the user (#330). People act on these totals, so they have to be right.

## What Changes

- A summary's counts and totals, for each group and overall, cover every row that matches its filters, however many there are. Its chart of counts per group does too.
- When more rows match than the summary lists, it says how many it lists out of how many, and what the totals cover.
- A downloaded summary has every matching row, with the same totals.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reports-and-charts`: summary totals and exports cover every matching row, and the summary says when it lists only some of them.

## Impact

The summary view asks the server for its totals instead of adding up the rows it fetched, and the export reads every page of rows. Connected tables whose source can't add up a column keep totals over the listed rows, and the summary says so.
