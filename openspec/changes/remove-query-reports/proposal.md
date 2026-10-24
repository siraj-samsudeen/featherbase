# Proposal

## Why

Query reports, a report that carries an admin-written database question, are not used: no instance has one and none is planned. Keeping them means keeping a separate database sign-in that only they needed. Removing both leaves less for anyone to secure or learn.

## What Changes

- Query reports are removed. A saved report is now either a built report (columns, grouping, filters over one Table) or a script report.
- A dashboard chart can follow a built or script report as before; the exception that let a chart show a query report's results to anyone who could open it goes with them.
- The separate database sign-in that query reports used is removed from every instance. Row-level protection for direct database connections stays and is still tested.
- An instance that still holds a query report stops its upgrade and names the report, so an operator decides what happens to it.
- When this change is archived, the dashboards spec's purpose drops the same exception; a delta cannot carry it.
